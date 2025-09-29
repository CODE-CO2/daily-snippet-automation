#!/usr/bin/env node
/* upload_snippets.js
 * 변경분만 업로드 + 캐시 + 수동 전체 재업로드 지원
 * 요구 Node >= 18 (fetch 내장)
 */

/// ─────────────────────────────────────────────────────────────
/// 모듈
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

/// ─────────────────────────────────────────────────────────────
/// 환경변수
const API_URL   = process.env.DAILY_SNIPPET_URL;
const API_KEY   = process.env.DAILY_SNIPPET_API_KEY; // Authorization: Bearer
const API_ID    = process.env.API_ID;                // body.api_id
const TEAM_NAME = process.env.TEAM_NAME || "7기-2팀";
const DEBUG     = process.env.DEBUG === "1";
const FORCE_FULL = process.env.FORCE_FULL === "1";   // 캐시 무시 전체 업로드

if (!API_URL)  { console.error("❌ DAILY_SNIPPET_URL is missing"); process.exit(1); }
if (!API_KEY)  { console.error("❌ DAILY_SNIPPET_API_KEY is missing"); process.exit(1); }
if (!API_ID)   { console.error("❌ API_ID is missing (본문의 api_id 필수)"); process.exit(1); }

/// ─────────────────────────────────────────────────────────────
/// 경로/상수
const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");
const STATE_FILE = path.join(ROOT, ".snippet_state.json"); // 파일별 내용 해시 캐시
const EMAIL_MAP = {
  eunho: "jeh0224@gachon.ac.kr",
  jieun: "wldms4849@gachon.ac.kr",
  siwan: "siwan@example.com",
  gyubi: "guebi1220@gachon.ac.kr",
};
// 허용 확장자(필요시 수정)
const ALLOWED_EXT_RE = /\.(md|txt|markdown)$/i;

/// ─────────────────────────────────────────────────────────────
/// 유틸
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function ymdFromFilename(name){
  const m = name.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function gitAuthorISODate(p){
  try {
    const s = execSync(`git log -1 --pretty=format:%aI -- "${p}"`, {encoding:"utf8"});
    return (s || "").trim() || null;
  } catch {
    return null;
  }
}

function isoToYmd(iso){
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

async function pathExists(p){
  try { await fsp.access(p, fs.constants.F_OK); return true; }
  catch { return false; }
}

function loadState(){
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || !obj.files) return { files: {} };
    return obj;
  } catch {
    return { files: {} };
  }
}

function saveState(state){
  const safe = { files: state.files || {} };
  fs.writeFileSync(STATE_FILE, JSON.stringify(safe, null, 2));
}

/// ─────────────────────────────────────────────────────────────
/// 메인
(async function main(){
  if (!(await pathExists(SNIPPETS_DIR))) {
    console.error("❌ No snippets/ directory.");
    process.exit(2);
  }

  const state = loadState(); // { files: { "<fullpath>": { hash, at } } }
  let candidates = 0, uploaded = 0;

  // 작성자 폴더들
  const authorDirs = (await fsp.readdir(SNIPPETS_DIR, { withFileTypes: true }))
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const author of authorDirs) {
    const userEmail = EMAIL_MAP[author];
    if (!userEmail) {
      console.warn(`⚠️ Skip: unknown author "${author}"`);
      continue;
    }

    const dir = path.join(SNIPPETS_DIR, author);
    const files = (await fsp.readdir(dir))
      .filter(n => ALLOWED_EXT_RE.test(n));

    for (const fname of files) {
      const full = path.join(dir, fname);
      const raw = (await fsp.readFile(full, "utf8")).trim();
      const nowHash = sha256(raw);

      // 내용 해시 기반 변경 감지
      const prev = state.files[full];
      if (!FORCE_FULL && prev && prev.hash === nowHash) {
        if (DEBUG) console.log(`⏭️  Unchanged, skip: ${author}/${fname}`);
        continue;
      }

      // 날짜 결정: 파일명 YYYY-MM-DD → git author date → 오늘
      const ymdFromName = ymdFromFilename(fname);
      const createdIso = gitAuthorISODate(full) || new Date().toISOString();
      const snippet_date = ymdFromName || isoToYmd(createdIso) || new Date().toISOString().slice(0,10);

      // 페이로드
      const payload = {
        api_id: API_ID,
        user_email: userEmail,
        snippet_date,           // YYYY-MM-DD
        content: raw,
        team_name: TEAM_NAME,
        // LLM 프록시 노드(요구사항) - 최소 입력
        input: {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "ingest snippet" }],
          temperature: 0.0,
        },
      };

      candidates++;
      console.log(`↗️ ${author}/${fname} → ${userEmail} @ ${snippet_date}`);

      try {
        const out = await postSnippet(payload);
        uploaded++;
        // 성공 시 캐시 갱신
        state.files[full] = { hash: nowHash, at: new Date().toISOString() };
        console.log("✅ Uploaded:", out);
      } catch (e) {
        console.error(`❌ Failed ${author}/${fname}: ${e.message}`);
      }
    }
  }

  console.log(`Done. Candidates=${candidates}, Uploaded=${uploaded}.`);
  saveState(state);

  if (candidates === 0) {
    console.error("❌ No candidate files");
    process.exit(2);
  }
  if (uploaded === 0) {
    console.error("❌ 0 uploads (check api_id / input)");
    process.exit(3);
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
