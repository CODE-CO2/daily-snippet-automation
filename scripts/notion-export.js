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

// ensureDir 함수 정의 복구
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }


/**
 * Notion 블록 객체에서 텍스트를 추출하고 마크다운 형식으로 변환합니다.
 */
function blockToPlain(b) {
  const t = b.type;
  const data = b[t] || {};
  
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
      if (b.has_children && !['to_do', 'bulleted_list_item', 'numbered_list_item'].includes(b.type)) {
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
    
    // ⭐⭐ 날짜/이메일 중복 제거 필터링 로직 추가 ⭐⭐
    let cleanedBody = body;
    // 'Daily Snippet - YYYY-MM-DD - email@address.com' 패턴을 찾는 정규식
    // 날짜와 이메일은 변수로 받아 동적으로 만듭니다.
    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^Daily\\s+Snippet\\s+-\\s+${date}\\s+-\\s+${escapedEmail}\\s*\n?`);
    
    // 첫 번째 줄이 해당 패턴과 일치하면 제거합니다.
    if (body.match(regex)) {
        cleanedBody = body.replace(regex, '').trim();
    }
    // ⭐⭐ 필터링 로직 끝 ⭐⭐
    
    const key = `${email}|${date}`;
    if (!grouped[key]) grouped[key] = { texts: [], pageIds: [] };
    
    if (cleanedBody) { // 필터링된 내용 사용
        grouped[key].texts.push(cleanedBody);
    } else {
        console.warn(`⚠️ Empty body after filtering for page ID: ${p.id}`);
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
      
      // 순수 본문(merged)만 파일에 기록합니다. (이중 기록 제거)
      const content = merged;
      
      fs.writeFileSync(file, content, "utf8");
      console.log(`[notion-export] Wrote: ${file}`);
    }

    mapOut[key] = grouped[key].pageIds;
  }

  fs.writeFileSync(MAP_FILE, JSON.stringify(mapOut, null, 2));
  console.log(`[notion-export] Map saved: ${MAP_FILE}`);
})().catch((e) => { console.error(e); process.exit(1); });
