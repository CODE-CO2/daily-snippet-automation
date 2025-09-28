// scripts/probe-snippet.js
// 목적: 문서 없는 팀 API에서 "사용자 귀속"을 인식하는 필드/헤더 조합을 탐색
// 필요 Secrets: DAILY_SNIPPET_URL, DAILY_SNIPPET_API_KEY
// 실행: node scripts/probe-snippet.js

const fs = require("fs");
const path = require("path");

const API_URL = process.env.DAILY_SNIPPET_URL;
const API_KEY = process.env.DAILY_SNIPPET_API_KEY;
if (!API_URL || !API_KEY) {
  console.error("❌ DAILY_SNIPPET_URL or DAILY_SNIPPET_API_KEY missing");
  process.exit(1);
}

// 각 폴더명 → 실제 구글 계정 이메일
const EMAIL_MAP = {
  eunho: "jeh0224@gachon.ac.kr",
  jieun: "jieun@example.com",
  siwan: "siwan@example.com",
  gyubi: "gyubi@example.com",
};

// 후보 필드/헤더
const FIELD_CANDIDATES = ["user_email", "email", "google_email", "account_email", "userId", "user_id"];
const HEADER_CANDIDATES = ["X-User-Email", "X-DS-User-Email", "X-Impersonate-User", "X-Act-As-User", null];

function kstIsoMidnight(ymd) { // 'YYYY-MM-DD' -> 'YYYY-MM-DDT00:00:00+09:00'
  return `${ymd}T00:00:00+09:00`;
}

function ymdFromName(name) {
  const m = name.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

async function postOnce({ ownerEmail, fieldName, headerName, title, content, created_at }) {
  const headers = {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
  if (headerName) headers[headerName] = ownerEmail;

  // 바디에는 모든 후보 필드 중 하나만 “주요 식별자”로, 그리고 호환용으로 author_email도 함께 보냄
  const body = {
    [fieldName]: ownerEmail,
    author_email: ownerEmail,
    title,
    content,
    created_at,
    source: "github-probe",
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  return { status: res.status, statusText: res.statusText, text };
}

(async function main() {
  const ROOT = process.cwd();
  const SNIPPETS_DIR = path.join(ROOT, "snippets");
  if (!fs.existsSync(SNIPPETS_DIR)) {
    console.error("❌ snippets/ not found");
    process.exit(2);
  }

  // candidates: snippets/<author>/<file> 중 1개씩만 대표로 사용
  const reps = [];
  for (const author of Object.keys(EMAIL_MAP)) {
    const dir = path.join(SNIPPETS_DIR, author);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(n => /\.(md|txt|markdown)$/i.test(n));
    if (files.length === 0) continue;
    reps.push({ author, file: files[0] });
  }
  if (reps.length === 0) {
    console.error("❌ No sample files found under snippets/<author>");
    process.exit(3);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const results = [];

  for (const { author, file } of reps) {
    const email = EMAIL_MAP[author];
    const full = path.join(SNIPPETS_DIR, author, file);
    const content = fs.readFileSync(full, "utf8").slice(0, 500);
    const ymd = ymdFromName(file);
    const created_at = ymd ? kstIsoMidnight(ymd) : new Date().toISOString();

    for (const fieldName of FIELD_CANDIDATES) {
      for (const headerName of HEADER_CANDIDATES) {
        const tag = `PROBE-${author}-${fieldName}-${headerName || "nohdr"}-${ts}`;
        const title = `🧪 ${tag}`;
        const preview = (content || "").split("\n").slice(0, 3).join(" | ");

        try {
          const r = await postOnce({
            ownerEmail: email,
            fieldName,
            headerName,
            title,
            content: `(${tag}) ${preview}`,
            created_at,
          });
          console.log(`${author} | ${fieldName} | ${headerName || "-"} => ${r.status} ${r.statusText}`);
          results.push({ author, fieldName, headerName, status: r.status, statusText: r.statusText, titleTag: tag });
        } catch (e) {
          console.log(`${author} | ${fieldName} | ${headerName || "-"} => ERROR ${e.message}`);
          results.push({ author, fieldName, headerName, error: e.message, titleTag: tag });
        }
      }
    }
  }

  // 간단한 표 출력
  console.log("\n=== PROBE SUMMARY (find 2xx then search that tag in UI) ===");
  for (const r of results) {
    if (r.error) {
      console.log(`✗ ${r.author} | ${r.fieldName} | ${r.headerName || "-"} | ERROR: ${r.error}`);
    } else {
      const ok = r.status >= 200 && r.status < 300 ? "✓" : "✗";
      console.log(`${ok} ${r.author} | ${r.fieldName} | ${r.headerName || "-"} | ${r.status} | ${r.titleTag}`);
    }
  }
})();
