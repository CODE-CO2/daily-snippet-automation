// scripts/upload-snippets.js
// 목적: snippets/<author>/*.md|txt|markdown 을 읽어서
// Daily Snippet API(Webhook)로 POST
// 요구 바디: { user_email, snippet_date(YYYY-MM-DD), content, team_name? }
//
// 필요 시크릿: DAILY_SNIPPET_URL, DAILY_SNIPPET_API_KEY
// 선택 ENV: TEAM_NAME (예: "7기-2팀"), DEBUG=1 (자세한 로그)

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const API_URL = process.env.DAILY_SNIPPET_URL;
const API_KEY = process.env.DAILY_SNIPPET_API_KEY;
const TEAM_NAME = process.env.TEAM_NAME || "7기-2팀";
const DEBUG = process.env.DEBUG === "1";

if (!API_URL) { console.error("❌ DAILY_SNIPPET_URL is missing"); process.exit(1); }
if (!API_KEY) { console.error("❌ DAILY_SNIPPET_API_KEY is missing"); process.exit(1); }

const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");

// 🔁 폴더명 → 실제 구글 이메일로 꼭 맞춰주세요
const EMAIL_MAP = {
  eunho: "jeh0224@gachon.ac.kr",
  jieun: "jieun@example.com",
  siwan: "siwan@example.com",
  gyubi: "gyubi@example.com",
};

// 파일명에서 YYYY-MM-DD 추출
function ymdFromFilename(name) {
  const m = name.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// git 마지막 커밋 AuthorDate(ISO). 실패 시 null
function gitAuthorISODate(filePath) {
  try {
    const out = execSync(`git log -1 --pretty=format:%aI -- "${filePath}"`, { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// ISO 문자열 → YYYY-MM-DD (단순 split)
function isoToYmd(iso) {
  return (iso || "").split("T")[0] || null;
}

async function postSnippet(payload) {
  const headers = {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };

  if (DEBUG) {
    const safe = { ...headers, Authorization: "Bearer ****" };
    console.log("[DEBUG] POST", API_URL);
    console.log("[DEBUG] HEADERS", safe);
    console.log("[DEBUG] BODY", JSON.stringify(payload));
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (DEBUG) console.log("[DEBUG] RESP", res.status, res.statusText, text);

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}\n${text}`);
  try { return JSON.parse(text); } catch { return { ok: true, text }; }
}

(async function main() {
  if (!fs.existsSync(SNIPPETS_DIR)) {
    console.error("❌ No snippets/ directory.");
    process.exit(2);
  }

  let candidates = 0;
  let uploaded = 0;

  const authors = fs.readdirSync(SNIPPETS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  if (DEBUG) console.log("[DEBUG] authors:", authors);

  for (const author of authors) {
    const userEmail = EMAIL_MAP[author];
    if (!userEmail) {
      console.warn(`⚠️ Skip: unknown author folder "${author}" (EMAIL_MAP에 없음)`);
      continue;
    }

    const dirPath = path.join(SNIPPETS_DIR, author);
    const files = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(f => f.isFile())
      .map(f => f.name)
      .filter(n => /\.(md|txt|markdown)$/i.test(n));

    if (DEBUG) console.log("[DEBUG]", author, "files:", files);

    for (const fname of files) {
      const full = path.join(dirPath, fname);
      const content = fs.readFileSync(full, "utf8").trim();

      // 날짜 결정: 파일명 YYYY-MM-DD 우선 → 없으면 git author date → 없으면 오늘(UTC)
      const fromName = ymdFromFilename(fname);
      let snippetDate = fromName;
      if (!snippetDate) {
        const iso = gitAuthorISODate(full) || new Date().toISOString();
        snippetDate = isoToYmd(iso) || new Date().toISOString().slice(0, 10);
      }

      // API가 요구하는 바디에 맞춰 매핑 (❗️배열이 아니라 '단일 객체')
      const payload = {
        user_email: userEmail,
        snippet_date: snippetDate, // YYYY-MM-DD
        content,
        team_name: TEAM_NAME,      // 선택 필드 (있으면 추가)
      };

      candidates += 1;
      console.log(`↗️ ${author}/${fname} → ${userEmail} @ ${snippetDate}`);

      try {
        const out = await postSnippet(payload);
        uploaded += 1;
        console.log("✅ Uploaded:", out);
      } catch (e) {
        console.error(`❌ Failed ${author}/${fname}: ${e.message}`);
      }
    }
  }

  console.log(`Done. Candidates=${candidates}, Uploaded=${uploaded}.`);
  if (candidates === 0) { console.error("❌ No candidate files under snippets/<author>"); process.exit(2); }
  if (uploaded === 0)   { console.error("❌ 0 uploads. Check API/required fields."); process.exit(3); }
})().catch(e => { console.error(e); process.exit(1); });
