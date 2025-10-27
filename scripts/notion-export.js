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
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

/**
 * Notion 블록 객체에서 텍스트를 추출하고 마크다운 형식으로 변환합니다.
 * ⭐ 이 함수가 주요 수정 대상입니다.
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
    case "divider": return "---"; // 구분선 추가
    case "callout": 
      const icon = data.icon?.emoji || '💡'; 
      return `> ${icon} ${text}`; // callout 처리
    case "code":
      // code 블록은 rich_text를 사용하지만, 마크다운 코드 블록으로 포맷합니다.
      const codeText = data.rich_text.map(r => r.plain_text).join('');
      const language = data.language || 'text';
      return `\n\`\`\`${language}\n${codeText}\n\`\`\`\n`; // 코드 블록 처리
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
      // paragraph, template_text 등의 기본 텍스트 블록 처리
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
      // 자식 블록(nested blocks)은 이 코드에서 제외합니다.
      if (b.has_children && !['to_do', 'bulleted_list_item', 'numbered_list_item'].includes(b.type)) {
          // 토글이나 기타 컨테이너 블록은 본문 추출 시 복잡해지므로,
          // 필요하다면 재귀적으로 처리해야 하나 여기서는 텍스트만 추출합니다.
          // 현재는 텍스트가 없는 컨테이너 블록만 스킵합니다.
      }
      
      const line = blockToPlain(b);
      // 빈 문자열이거나 줄 바꿈만 있는 경우 추가하지 않습니다.
      if (line && line.trim().length > 0) lines.push(line);
    }
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  
  // 최종적으로 추출된 텍스트는 줄 바꿈으로 결합하여 반환합니다.
  return lines.join("\n").trim();
}

async function queryPagesForDate(ymd) {
  const filter = {
    and: [
      { property: "Date", date: { on_or_after: ymd } },
      { property: "Date", date: { on_or_before: ymd } },
      // 400 validation_error 해결: Posted=false 조건 하나로 단순화합니다.
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
    // date와 email 추출 로직은 그대로 유지
    const date = (props?.Date?.date?.start || "").slice(0, 10);
    const email =
      props?.Email?.email ||
      (props?.Author?.people?.[0]?.person?.email || "").trim();

    if (!date || !email) {
      console.warn(`⚠️ Skip (missing date or email): ${p.id}`);
      continue;
    }

    // ⭐ 본문 내용 추출
    const body = await readBlocksAsText(p.id);
    const key = `${email}|${date}`;
    if (!grouped[key]) grouped[key] = { texts: [], pageIds: [] };
    
    // ⭐ body가 비어있지 않은 경우에만 추가하여, 내용이 없는 페이지는 병합 시 제외됩니다.
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
      // texts 배열에 내용이 있는 항목만 병합합니다.
      const merged = grouped[key].texts.filter(Boolean).join("\n\n---\n\n").trim();
      
      // 내용이 없으면 파일을 만들지 않거나, 내용 없음 메시지를 넣습니다.
      if (!merged) {
         console.warn(`⚠️ Skip file creation: No content merged for ${key}`);
         continue; 
      }
      
      const title = `Daily Snippet - ${date} - ${email}`;
      const content = [title, "=".repeat(title.length), "", merged].join("\n");
      fs.writeFileSync(file, content, "utf8");
      console.log(`[notion-export] Wrote: ${file}`);
    }

    mapOut[key] = grouped[key].pageIds;
  }

  fs.writeFileSync(MAP_FILE, JSON.stringify(mapOut, null, 2));
  console.log(`[notion-export] Map saved: ${MAP_FILE}`);
})().catch((e) => { console.error(e); process.exit(1); });
