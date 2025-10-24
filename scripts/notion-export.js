"use strict";

/**
 * Notion DB에서 TARGET_DATE(YYYY-MM-DD) + Posted != true 인 페이지를 읽어
 * snippets/<folder>/<YYYY-MM-DD>.txt를 생성하고
 * .cache/notion-map.json 에 (email|date) -> pageId[]를 기록합니다.
 */

const fs = require("fs");
const path = require("path");
const Notion = require("@notionhq/client");            // ✅ 네임스페이스 import

// ---------- ENV ----------
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const TARGET_DATE = (process.env.TARGET_DATE || "").slice(0, 10);

if (!NOTION_TOKEN || !NOTION_DB_ID) {
  console.error("❌ NOTION_TOKEN or NOTION_DB_ID is missing");
  process.exit(1);
}
if (!TARGET_DATE) {
  console.error("❌ TARGET_DATE is missing (YYYY-MM-DD)");
  process.exit(1);
}

// ✅ Client 인스턴스 (이름 충돌 피하기)
const notionClient = new Notion.Client({ auth: NOTION_TOKEN });

// 실행 가드: query 함수가 없으면 즉시 실패
if (
  !notionClient.databases ||
  typeof notionClient.databases.query !== "function"
) {
  console.error("❌ Notion client is invalid: databases.query not found");
  console.error("   @notionhq/client version:",
    (() => {
      try { return require("@notionhq/client/package.json").version; }
      catch { return "unknown"; }
    })()
  );
  process.exit(1);
}

// 레포 기준 매핑(폴더 → 이메일)
const FOLDER_TO_EMAIL = {
  eunho: "jeh0224@gachon.ac.kr",
  jieun: "wldms4849@gachon.ac.kr",
  siwan: "gamja5356@gachon.ac.kr",
  guebi: "guebi1220@gachon.ac.kr",
};
// 이메일 → 폴더 역매핑
const EMAIL_TO_FOLDER = Object.fromEntries(
  Object.entries(FOLDER_TO_EMAIL).map(([folder, email]) => [email, folder])
);

const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");
const CACHE_DIR = path.join(ROOT, ".cache");
const MAP_FILE = path.join(CACHE_DIR, "notion-map.json");

// ---------- helpers ----------
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function blockToPlain(b) {
  const t = b.type;
  const data = b[t] || {};
  const rt = data.rich_text || [];
  const text = rt.map(r => r.plain_text || "").join("");

  switch (t) {
    case "heading_1": return `# ${text}`;
    case "heading_2": return `## ${text}`;
    case "heading_3": return `### ${text}`;
    case "bulleted_list_item": return `- ${text}`;
    case "numbered_list_item": return `1. ${text}`;
    case "to_do": return `${data.checked ? "[x]" : "[ ]"} ${text}`;
    case "quote": return `> ${text}`;
    default: return text; // paragraph 등
  }
}

async function readBlocksAsText(pageId) {
  const lines = [];
  let cursor;
  do {
    const resp = await notionClient.blocks.children.list({
      block_id: pageId, page_size: 100, start_cursor: cursor,
    });
    for (const b of resp.results) {
      const line = blockToPlain(b);
      if (line) lines.push(line);
    }
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  return lines.join("\n").trim();
}

async function queryPagesForDate(ymd) {
  const filter = {
    and: [
      { property: "Date", date: { on_or_after: ymd } },
      { property: "Date", date: { on_or_before: ymd } },
      { or: [
          { property: "Posted", checkbox: { equals: false } },
          { property: "Posted", checkbox: { is_empty: true } },
        ],
      },
    ],
  };

  const pages = [];
  let cursor;
  do {
    const resp = await notionClient.databases.query({
      database_id: NOTION_DB_ID,
      filter,
      start_cursor: cursor,
    });
    pages.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return pages;
}

// ---------- main ----------
(async function main() {
  ensureDir(SNIPPETS_DIR);
  ensureDir(CACHE_DIR);

  const pages = await queryPagesForDate(TARGET_DATE);

  if (!pages.length) {
    console.log(`[notion-export] No pages for ${TARGET_DATE}`);
    fs.writeFileSync(MAP_FILE, JSON.stringify({}, null, 2));
    return;
  }

  const grouped = {}; // key: `${email}|${date}` → { texts:[], pageIds:[] }

  for (const p of pages) {
    const props = p.properties || {};
    const date = (props?.Date?.date?.start || "").slice(0, 10);
    const email =
      props?.Email?.email ||
      (props?.Author?.people?.[0]?.person?.email || "").trim();

    if (!date || !email) {
      console.warn(`⚠️ Skip (missing date or email): ${p.id}`);
      continue;
    }

    const body = await readBlocksAsText(p.id);
    const key = `${email}|${date}`;
    if (!grouped[key]) grouped[key] = { texts: [], pageIds: [] };
    grouped[key].texts.push(body || "");
    grouped[key].pageIds.push(p.id);
  }

  const mapOut = {};
  for (const key of Object.keys(grouped)) {
    const [email, date] = key.split("|");
    const folder = EMAIL_TO_FOLDER[email];
    if (!folder) { console.warn(`⚠️ Unknown email → folder: ${email}`); continue; }

    const dir = path.join(SNIPPETS_DIR, folder);
    ensureDir(dir);
    const file = path.join(dir, `${date}.txt`);

    if (fs.existsSync(file)) {
      console.log(`[notion-export] Exists, skip: ${file}`);
    } else {
      const merged = grouped[key].texts.filter(Boolean).join("\n\n---\n\n").trim();
      const title = `Daily Snippet - ${date} - ${email}`;
      const content = [title, "=".repeat(title.length), "", merged || "(내용 없음)"].join("\n");
      fs.writeFileSync(file, content, "utf8");
      console.log(`[notion-export] Wrote: ${file}`);
    }

    mapOut[key] = grouped[key].pageIds;
  }

  fs.writeFileSync(MAP_FILE, JSON.stringify(mapOut, null, 2));
  console.log(`[notion-export] Map saved: ${MAP_FILE}`);
})().catch((e) => { console.error(e); process.exit(1); });
