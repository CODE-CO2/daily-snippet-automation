// scripts/upload-snippets.js
// snippets/<folder>/<YYYY-MM-DD>.* 를 읽어 Daily Snippet 서버로 POST.
// 성공 시 .cache/notion-map.json 을 참고해 해당 Notion 페이지들에 Posted=true + Posted At 기록.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Client } = require("@notionhq/client");

// ----- Daily Snippet API
const API_URL = process.env.DAILY_SNIPPET_URL;
const API_KEY = process.env.DAILY_SNIPPET_API_KEY;
const TEAM_NAME = process.env.TEAM_NAME || "7기-2팀";
const DEBUG = process.env.DEBUG === "1";

// ----- Notion(optional for Posted=true update)
const NOTION_TOKEN = process.env.NOTION_TOKEN || "";
const NOTION_DB_ID = process.env.NOTION_DB_ID || "";
const notion = NOTION_TOKEN ? new Client({ auth: NOTION_TOKEN }) : null;

if (!API_URL) { console.error("❌ DAILY_SNIPPET_URL is missing"); process.exit(1); }
if (!API_KEY) { console.error("❌ DAILY_SNIPPET_API_KEY is missing"); process.exit(1); }

const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");
const CACHE_FILE = path.join(ROOT, ".cache", "notion-map.json");

// ✅ 레포에 있는 매핑 유지(폴더 → 이메일)
const EMAIL_MAP = {
  eunho: "jeh0224@gachon.ac.kr",
  jieun: "wldms4849@gachon.ac.kr",
  siwan: "gamja5356@gachon.ac.kr",
  guebi: "guebi1220@gachon.ac.kr",
};

function ymdFromFilename(name) {
  const m = name.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
function gitAuthorISODate(p) {
  try {
    return execSync(`git log -1 --pretty=format:%aI -- "${p}"`, { encoding: "utf8" }).trim() || null;
  } catch { return null; }
}
function isoToYmd(iso) {
  return (iso || "").split("T")[0] || null;
}

async function postSnippet(payload) {
  const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };
  if (DEBUG) {
    console.log("[DEBUG] POST", API_URL);
    console.log("[DEBUG] HEADERS", { ...headers, Authorization: "Bearer ****" });
    console.log("[DEBUG] BODY", JSON.stringify(payload));
  }
  const res = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify(payload) });
  const text = await res.text();
  if (DEBUG) console.log("[DEBUG] RESP", res.status, res.statusText, text);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}\n${text}`);
  try { return JSON.parse(text); } catch { return { ok: true, text }; }
}

async function markNotionPosted(email, ymd) {
  if (!notion) return;
  let map = {};
  if (fs.existsSync(CACHE_FILE)) {
    try { map = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch { map = {}; }
  }
  const key = `${email}|${ymd}`;
  const ids = map[key] || [];
  if (!ids.length) {
    if (DEBUG) console.log(`[DEBUG] No Notion pageIds for ${key}`);
    return;
  }

  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const kstISO = new Date(kst.getTime() - kst.getTimezoneOffset() * 60000).toISOString();

  for (const pid of ids) {
    try {
      await notion.pages.update({
        page_id: pid,
        properties: {
          Posted: { checkbox: true },
          "Posted At": { date: { start: kstISO } }, // 필드 없으면 무시됨
        },
      });
      if (DEBUG) console.log(`[DEBUG] Notion updated Posted=true (${pid})`);
    } catch (e) {
      console.warn(`⚠️ Notion update failed (${pid}): ${e.message}`);
    }
  }
}

(async function main() {
  if (!fs.existsSync(SNIPPETS_DIR)) {
    console.error("❌ No snippets/ directory.");
    process.exit(2);
  }

  let candidates = 0, uploaded = 0;

  const authors = fs.readdirSync(SNIPPETS_DIR, { withFileTypes: true })
                    .filter((d) => d.isDirectory())
                    .map((d) => d.name);

  for (const author of authors) {
    const userEmail = EMAIL_MAP[author];
    if (!userEmail) {
      console.warn(`⚠️ Skip: unknown author "${author}"`);
      continue;
    }

    const dir = path.join(SNIPPETS_DIR, author);
    const files = fs.readdirSync(dir).filter((n) => /\.(md|markdown|txt)$/i.test(n));

    for (const fname of files) {
      const full = path.join(dir, fname);
      const content = fs.readFileSync(full, "utf8").trim();

      const ymdName = ymdFromFilename(fname);
      const createdIso = gitAuthorISODate(full) || new Date().toISOString();
      const snippet_date = ymdName || isoToYmd(createdIso) || new Date().toISOString().slice(0, 10);

      const payload = {
        api_id: API_KEY,           // 서버 스펙: api_id 필드 요구 → API_KEY 재사용
        user_email: userEmail,
        snippet_date,
        content,
        team_name: TEAM_NAME,
      };

      candidates++;
      console.log(`↗️ ${author}/${fname} → ${userEmail} @ ${snippet_date}`);
      try {
        const out = await postSnippet(payload);
        uploaded++;
        console.log("✅ Uploaded:", out);

        await markNotionPosted(userEmail, snippet_date);
      } catch (e) {
        console.error(`❌ Failed ${author}/${fname}: ${e.message}`);
      }
    }
  }

  console.log(`Done. Candidates=${candidates}, Uploaded=${uploaded}.`);
  if (candidates === 0) process.exit(2);
  if (uploaded === 0) process.exit(3);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
