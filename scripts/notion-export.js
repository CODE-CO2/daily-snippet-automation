"use strict";

/**
 * Notion DB에서 TARGET_DATE(YYYY-MM-DD) + Posted != true 인 페이지를 읽어
 * snippets/<folder>/<YYYY-MM-DD>.txt를 생성하고
 * .cache/notion-map.json 에 (email|date) → pageId[]를 기록합니다.
 */

const fs = require("fs");
const path = require("path");
const Notion = require("@notionhq/client");

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

const notionClient = new Notion.Client({ auth: NOTION_TOKEN });

// 실행 가드
if (
  !notionClient.databases ||
  typeof notionClient.databases.query !== "function"
) {
  console.error("❌ Notion client is invalid: databases.query not found");
  console.error("    @notionhq/client version:",
    (() => {
      try { return require("@notionhq/client/package.json").version; }
      catch { return "unknown"; }
    })()
  );
  process.exit(1);
}

const FOLDER_TO_EMAIL = {
  eunho: "jeh0224@gachon.ac.kr",
  jieun: "wldms4849@gachon.ac.kr",
  siwan: "gamja5356@gachon.ac.kr",
  guebi: "guebi1220@gachon.ac.kr",
};
const EMAIL_TO_FOLDER = Object.fromEntries(
  Object.entries(FOLDER_TO_EMAIL).map(([folder, email]) => [email, folder])
);

const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");
const CACHE_DIR = path.join(ROOT, ".cache");
const MAP_FILE = path.join(CACHE_DIR, "notion-map.json");

// ---------- helpers ----------

// ⭐⭐⭐ ensureDir 함수 정의 복구 (ReferenceError 해결) ⭐⭐⭐
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }


/**
 * Notion 블록 객체에서 텍스트를 추출하고 마크다운 형식으로 변환합니다.
 * (본문 추출 누락 문제 해결 로직 포함)
 */
function blockToPlain(b) {
  const t = b.type;
  const data = b[t] || {};
  
  // 텍스트는 기본적으로 rich_text 배열에 있습니다.
  const rt = data.rich_text || [];
  let text = rt.map(r => r.plain_text || "").join("");

  switch (t) {
    case "heading_1": return `# ${text}`;
    case "heading_2": return `## ${text}`;
    case "heading_3": return `### ${text}`;
    case "bulleted_list_item": return `- ${text}`;
    case "numbered_list_item": return `1. ${text}`;
    case "to_do": return `${data.checked ? "[x]" : "[ ]"} ${text}`;
    case "quote": return `> ${text}`;
    case "divider": return "---";
    case "callout": 
      const icon = data.icon?.emoji || '💡'; 
      return `> ${icon} ${text}`; 
    case "code":
      const codeText = data.rich_text.map(r => r.plain_text).join('');
      const language = data.language || 'text';
      return `\n\`\`\`${language}\n${codeText}\n\`\`\`\n`; 
    case "image":
    case "file":
    case "video":
    case "pdf":
      return `[${t.toUpperCase()}: ${data.caption.map(r => r.plain_text || "").join("") || '파일'}]`;
    case "bookmark":
      return `[BOOKMARK: ${data.url}]`;
    case "link_preview":
      return `[LINK: ${data.url}]`;
    case "unsupported":
      return `[UNSUPPORTED BLOCK TYPE: ${t}]`;

    default: 
      // paragraph 등의 기본 텍스트 블록 처리
      return text;
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
      // 컨테이너 블록 처리는 복잡하므로, 텍스트가 있는 블록만 집중적으로 처리합니다.
      if (b.has_children && !['to_do', 'bulleted_list_item', 'numbered_list_item'].includes(b.type)) {
          // 토글 블록 등은 여기서 텍스트 추출을 생략하고 하위 블록은 무시
      }
      
      const line = blockToPlain(b);
      if (line && line.trim().length > 0) lines.push(line);
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
      // 400 validation_error 해결 로직 적용
      { property: "Posted", checkbox: { equals: false } }, 
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
  // ⭐ ensureDir 복구 후 정상 실행될 것입니다.
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
    
    if (body) {
        grouped[key].texts.push(body);
    } else {
        console.warn(`⚠️ Empty body for page ID: ${p.id}`);
    }
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
      
      if (!merged) {
         console.warn(`⚠️ Skip file creation: No content merged for ${key}`);
         continue; 
      }
      
      // ⭐⭐⭐ 최종 수정된 부분: 순수 본문(merged)만 파일에 기록합니다. ⭐⭐⭐
      // 이전에 파일에 제목을 명시적으로 추가하던 로직을 제거하여 중복을 방지합니다.
      const content = merged;
      
      fs.writeFileSync(file, content, "utf8");
      console.log(`[notion-export] Wrote: ${file}`);
    }

    mapOut[key] = grouped[key].pageIds;
  }

  fs.writeFileSync(MAP_FILE, JSON.stringify(mapOut, null, 2));
  console.log(`[notion-export] Map saved: ${MAP_FILE}`);
})().catch((e) => { console.error(e); process.exit(1); });
