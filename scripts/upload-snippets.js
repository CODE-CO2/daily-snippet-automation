// 목적
// - snippets/<author>/*.md|txt|markdown 읽어서 Daily Snippet API로 업로드
// - 커밋 트리거가 아니라 "스케줄" 또는 "수동 실행"으로 돌리기 좋게
// - 날짜/사람 필터 지원: TARGET_DATE(YYYY-MM-DD), AUTHOR_ONLY(폴더명)
// - 웹훅 요구사항: body에 api_id + input 블록 포함
//
// 필요 시크릿: DAILY_SNIPPET_URL, DAILY_SNIPPET_API_KEY, API_ID
// 선택 ENV: TEAM_NAME, TARGET_DATE, AUTHOR_ONLY, DRY_RUN, DEBUG

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const API_URL   = process.env.DAILY_SNIPPET_URL;
const API_KEY   = process.env.DAILY_SNIPPET_API_KEY; // Authorization 헤더
const API_ID    = process.env.API_ID;                // body.api_id
const TEAM_NAME = process.env.TEAM_NAME || "7기-2팀";
const TARGET_DATE = process.env.TARGET_DATE || "";   // "YYYY-MM-DD" (없으면 파일/커밋 날짜 사용)
const AUTHOR_ONLY = process.env.AUTHOR_ONLY || "";   // "eunho" 처럼 폴더명 1명만
const DRY_RUN  = process.env.DRY_RUN === "1";        // 건수/바디만 로그, 실제 전송 안함
const DEBUG    = process.env.DEBUG === "1";

if (!API_URL) { console.error("❌ DAILY_SNIPPET_URL is missing"); process.exit(1); }
if (!API_KEY) { console.error("❌ DAILY_SNIPPET_API_KEY is missing"); process.exit(1); }
if (!API_ID)  { console.error("❌ API_ID is missing (본문의 api_id 필수)"); process.exit(1); }

const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");

// 폴더명 ↔ 실제 구글 이메일 (팀원이 늘면 여기만 추가)
const EMAIL_MAP = {
  eunho: "jeh0224@gachon.ac.kr",
  jieun: "wldms4849@gachon.ac.kr",
  siwan: "siwan@example.com",
  gyubi: "guebi1220@gachon.ac.kr",
};

// YYYY-MM-DD 추출(파일명에 날짜 들어있으면 그걸 우선 사용)
function ymdFromFilename(name) {
  const m = name.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// git AuthorDate (ISO8601) → 실패 시 null
function gitAuthorISODate(filePath) {
  try {
    const out = execSync(`git log -1 --pretty=format:%aI -- "${filePath}"`, { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// ISO → YYYY-MM-DD
function isoToYmd(iso) {
  return (iso || "").split("T")[0] || null;
}

async function postSnippet(payload) {
  const headers = {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };

  if (DEBUG || DRY_RUN) {
    const safe = { ...headers, Authorization: "Bearer ****" };
    console.log("[DEBUG] POST", API_URL);
    console.log("[DEBUG] HEADERS", safe);
    console.log("[DEBUG] BODY", JSON.stringify(payload));
  }

  if (DRY_RUN) return { dryRun: true };

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

  // 대상 author 디렉토리 목록
  let authors = fs.readdirSync(SNIPPETS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  if (AUTHOR_ONLY) {
    authors = authors.filter(a => a === AUTHOR_ONLY);
  }

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

      // 날짜 결정: 파일명 날짜 → git AuthorDate → 오늘
      const fromName = ymdFromFilename(fname);
      const createdIso = gitAuthorISODate(full) || new Date().toISOString();
      const decidedDate = fromName || isoToYmd(createdIso) || new Date().toISOString().slice(0, 10);

      // 스케줄/수동 필터: TARGET_DATE가 지정되면 그 날짜만 업로드
      const snippet_date = TARGET_DATE ? TARGET_DATE : decidedDate;

      // 업로드 후보인지 체크
      if (TARGET_DATE && snippet_date !== TARGET_DATE) {
        // (TARGET_DATE를 강제 적용하므로 이 조건은 사실상 항상 false지만,
        // 혹시 decidedDate만 보고 거르려면 아래 줄로 대체:
        // if (decidedDate !== TARGET_DATE) continue;
      }

      const payload = {
        api_id: API_ID,          // 웹훅 요구 필수
        user_email: userEmail,
        snippet_date,            // YYYY-MM-DD
        content,
        team_name: TEAM_NAME,
        // 최소 input 블록 (n8n LLM 노드 통과 용)
        input: {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "ingest snippet" }],
          temperature: 0.0
        }
      };

      candidates += 1;
      console.log(`↗️ ${author}/${fname} → ${userEmail} @ ${snippet_date}`);

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
  if (!DRY_RUN && uploaded === 0) { console.error("❌ 0 uploads (check api_id / required fields)"); process.exit(3); }
})().catch(e => { console.error(e); process.exit(1); });
