// scripts/notion-export.js  (CommonJS)
const fs = require("fs");
const path = require("path");
const { Client } = require("@notionhq/client");

// ---- env
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const AUTHOR_MAP_JSON = process.env.NOTION_AUTHOR_MAP || "{}";
const TARGET_DATE = (process.env.TARGET_DATE || "").slice(0, 10); // YYYY-MM-DD

if (!NOTION_TOKEN || !NOTION_DB_ID) {
  console.error("❌ NOTION_TOKEN or NOTION_DB_ID is missing");
  process.exit(1);
}
if (!TARGET_DATE) {
  console.error("❌ TARGET_DATE is missing (YYYY-MM-DD)");
  process.exit(1);
}

const EMAIL_TO_FOLDER = JSON.parse(AUTHOR_MAP_JSON); // {email: "eunho", ...}
const notion = new Client({ auth: NOTION_TOKEN });

const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");
const CACHE_DIR = path.join(ROOT, ".cache");
const MAP_FILE = path.join(CACHE_DIR, "notion-map.json");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function toPlain(block) {
  const t = block.type;
  const data = block[t] || {};
  const rt = data.rich_text || [];
  return rt.map(r => r.plain_text || "").join("");
}

async function readPageBlocksText(pageId) {
  const lines = [];
  let cursor = undefined;
  do {
    const resp = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      start_cursor: cursor,
    });
    for (const b of resp.results) {
      lines.push(toPlain(b));
    }
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  return lines.filter(Boolean).join("\n");
}

async function queryTodayPages() {
  const filter = {
    and: [
      { property: "Date", date: { on_or_after: TARGET_DATE } },
      { property: "Date", date: { on_or_before: TARGET_DATE } },
      // Posted != true (체크박스가 없거나 false 인 것만)
      {
        or: [
          { property: "Posted", checkbox: { equals: false } },
          { property: "Posted", checkbox: { is_empty: true } },
        ],
      },
    ],
  };

  const pages = [];
  let cursor = undefined;
  do {
    const resp = await notion.databases.query({
      database_id: NOTION_DB_ID,
      filter,
      start_cursor: cursor,
    });
    pages.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return pages;
}

function resolveFolder(email) {
  return EMAIL_TO_FOLDER[email] || null;
}

(async function main() {
  ensureDir(SNIPPETS_DIR);
  ensureDir(CACHE_DIR);

  const pages = await queryTodayPages();
  if (!pages.length) {
    console.log(`[notion-export] No Notion pages for ${TARGET_DATE}`);
    // 빈 매핑도 기록 (업로더가 읽을 때 에러 방지)
    fs.writeFileSync(MAP_FILE, JSON.stringify({}, null, 2));
    return;
  }

  // email|date 별로 본문 합치기
  const grouped = {}; // key: `${email}|${TARGET_DATE}` => { texts:[], pageIds:[] }
  for (const p of pages) {
    const props = p.properties || {};
    const date = (props?.Date?.date?.start || "").slice(0, 10);
    const email =
      props?.Email?.email ||
      (props?.Author?.people?.[0]?.person?.email || "").trim();

    if (!date || !email) {
      console.warn("⚠️ Skip page (missing date or email):", p.id);
      continue;
    }

    const text = await readPageBlocksText(p.id);
    const key = `${email}|${date}`;
    if (!grouped[key]) grouped[key] = { texts: [], pageIds: [] };
    grouped[key].texts.push(text || "");
    grouped[key].pageIds.push(p.id);
  }

  const mapOut = {};
  for (const key of Object.keys(grouped)) {
    const [email, date] = key.split("|");
    const folder = resolveFolder(email);
    if (!folder) {
      console.warn(`⚠️ Unknown email(${email}) → folder mapping. Skip.`);
      continue;
    }

    const dir = path.join(SNIPPETS_DIR, folder);
    ensureDir(dir);
    const file = path.join(dir, `${date}.txt`);

    // 이미 파일이 있으면 덮어쓰지 않음 (수동 작성 존중)
    if (fs.existsSync(file)) {
      console.log(`[notion-export] Exists, skip write: ${file}`);
    } else {
      const body = grouped[key].texts.filter(Boolean).join("\n\n---\n\n").trim();
      const title = `Daily Snippet - ${date} - ${email}`;
      const content = [title, "".padEnd(title.length, "="), "", body || "(내용 없음)"].join("\n");
      fs.writeFileSync(file, content, "utf8");
      console.log(`[notion-export] Wrote: ${file}`);
    }

    mapOut[key] = grouped[key].pageIds;
  }

  fs.writeFileSync(MAP_FILE, JSON.stringify(mapOut, null, 2));
  console.log(`[notion-export] Map saved: ${MAP_FILE}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
