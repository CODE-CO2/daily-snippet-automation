// scripts/upload-snippets.js
// 팀 단일 API로 인증하면서, 각 파일을 "해당 사용자(구글 이메일)"의 스니펫으로 귀속시켜 업로드합니다.
// - Secrets: DAILY_SNIPPET_URL, DAILY_SNIPPET_API_KEY
// - 선택 env: USER_ID_FIELD(기본 user_email), IMPERSONATION_HEADER(기본 X-DS-User-Email)
// - 파일명 YYYY-MM-DD.* 이면 그 날짜를 created_at/date로 사용 (KST 00:00:00)
// - DEBUG=1 이면 상세 로그, 후보 0/업로드 0이면 실패 코드로 종료

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const API_URL = process.env.DAILY_SNIPPET_URL;
const API_KEY = process.env.DAILY_SNIPPET_API_KEY;
const USER_ID_FIELD = process.env.USER_ID_FIELD || "user_email";
const IMPERSONATION_HEADER = process.env.IMPERSONATION_HEADER || "X-DS-User-Email";
const DEBUG = process.env.DEBUG === "1";

if (!API_URL) { console.error("❌ DAILY_SNIPPET_URL is missing"); process.exit(1); }
if (!API_KEY) { console.error("❌ DAILY_SNIPPET_API_KEY is missing"); process.exit(1); }

const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");

// 폴더명 ↔ 실제 구글 계정 이메일 (꼭 실제 이메일로 교체하세요)
const EMAIL_MAP = {
  eunho: "jeh0224@gachon.ac.kr",
  jieun: "jieun@example.com",
  siwan: "siwan@example.com",
  gyubi: "gyubi@example.com",
};

// YYYY-MM-DD → KST ISO (00:00:00+09:00)
function ymdToKstIso(ymd) {
  // ymd: '2025-09-28'
  return `${ymd}T00:00:00+09:00`;
}

// 파일명에서 날짜 추출 (YYYY-MM-DD)
function dateFromFilename(filename) {
  const m = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function gitAuthorISODate(filePath) {
  try {
    const out = execSync(`git log -1 --pretty=format:%aI -- "${filePath}"`, { encoding: "utf8" }).trim();
    return out || null;
  } catch { return null; }
}

async function postToApi(ownerEmail, payload) {
  const headers = {
    "Authorization": `Bearer ${API_KEY}`,   // 팀 키 (백엔드가 요구하면 유지)
    "Content-Type": "application/json",
  };
  if (IMPERSONATION_HEADER) headers[IMPERSONATION_HEADER] = ownerEmail; // 서버가 지원 시 유효

  if (DEBUG) {
    const safeHeaders = { ...headers, Authorization: "Bearer ****" };
    console.log("[DEBUG] POST", API_URL);
    console.log("[DEBUG] HEADERS", safeHeaders);
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

function inferTitleFromName(name) {
  const base = path.basename(name, path.extname(name));
  return `Daily note ${base}`;
}

(async function main() {
  if (!fs.existsSync(SNIPPETS_DIR)) {
    console.error("❌ No snippets/ directory.");
    process.exit(2);
  }

  let uploaded = 0;
  let candidates = 0;

  const authors = fs.readdirSync(SNIPPETS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  if (DEBUG) console.log("[DEBUG] author dirs:", authors);

  for (const authorDir of authors) {
    const ownerEmail = EMAIL_MAP[authorDir];
    if (!ownerEmail) {
      console.warn(`⚠️ Skip: unknown author dir "${authorDir}" (EMAIL_MAP에 없음)`);
      continue;
    }

    const dirPath = path.join(SNIPPETS_DIR, authorDir);
    const files = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(f => f.isFile())
      .map(f => f.name)
      .filter(name => /\.(md|txt|markdown)$/i.test(name));

    if (DEBUG) console.log("[DEBUG]", authorDir, "files:", files);

    for (const fname of files) {
      const full = path.join(dirPath, fname);
      const content = fs.readFileSync(full, "utf8");

      // 1) 파일명에서 날짜 우선
      const ymd = dateFromFilename(fname);
      let createdAt;
      let dateField; // UI가 YYYY-MM-DD만 받는 경우 대비
      if (ymd) {
        createdAt = ymdToKstIso(ymd);
        dateField = ymd;
      } else {
        // 2) 없으면 git author date → 최종 fallback: 지금
        createdAt = gitAuthorISODate(full) || new Date().toISOString();
        // dateField는 생략 가능
      }

      const title = inferTitleFromName(fname);

      // 백엔드/앱이 어떤 키를 읽는지 불확실할 수 있어
      // - USER_ID_FIELD(기본 user_email) + author_email 둘 다 넣어줌
      const payload = {
        [USER_ID_FIELD]: ownerEmail,  // 예: user_email
        author_email: ownerEmail,     // 호환용
        title,
        content,
        created_at: createdAt,        // ISO8601 (KST 또는 ISO)
        source: "github",
      };
      if (dateField) payload.date = dateField; // UI가 YYYY-MM-DD만 쓸 때

      candidates += 1;
      console.log(`↗️ Uploading ${authorDir}/${fname} → ${ownerEmail} @ ${createdAt}`);

      try {
        const out = await postToApi(ownerEmail, payload);
        uploaded += 1;
        console.log("✅ Uploaded:", out);
      } catch (e) {
        console.error(`❌ Failed ${authorDir}/${fname}: ${e.message}`);
      }
    }
  }

  console.log(`Done. Candidates=${candidates}, Uploaded=${uploaded}.`);
  if (candidates === 0) { console.error("❌ No candidate files under snippets/<author>/*.md|txt|markdown"); process.exit(2); }
  if (uploaded === 0)   { console.error("❌ 0 uploads (서버에서 사용자 귀속 처리 확인 필요)"); process.exit(3); }
})().catch(e => { console.error(e); process.exit(1); });
