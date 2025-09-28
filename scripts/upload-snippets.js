// scripts/upload-snippets.js
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// === 환경변수 (Secrets에서 주입) ===
const API_URL = process.env.DAILY_SNIPPET_URL; // n8n webhook
if (!API_URL) {
  console.error("❌ DAILY_SNIPPET_URL is missing");
  process.exit(1);
}

// 디버그 스위치 (워크플로우 env에 DEBUG=1 주면 상세 로그)
const DEBUG = process.env.DEBUG === "1";

// === 레포 구조 ===
const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");

// 팀원 폴더명 → 이메일 매핑 (필요에 맞게 수정)
const EMAIL_MAP = {
  jieun: "jieun@example.com",
  eunho: "jeh0224@gachon.ac.kr",
  siwan: "siwan@example.com",
  gyubi: "gyubi@example.com",
};

// 파일의 마지막 커밋 AuthorDate(ISO)
function gitAuthorISODate(filePath) {
  try {
    const out = execSync(`git log -1 --pretty=format:%aI -- "${filePath}"`, {
      encoding: "utf8",
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// n8n으로 전송
async function uploadSnippet(row) {
  if (DEBUG) {
    console.log("[DEBUG] POST", API_URL);
    console.log("[DEBUG] BODY", JSON.stringify(row));
  }
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  const text = await res.text(); // n8n은 빈 본문/텍스트일 수 있음
  if (DEBUG) console.log("[DEBUG] RESP", res.status, res.statusText, text);
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}\n${text}`);
  try { return JSON.parse(text); } catch { return { ok: true, text }; }
}

function inferTitleFromName(name) {
  const base = path.basename(name, path.extname(name));
  return `Daily note ${base}`;
}

(async function main() {
  if (!fs.existsSync(SNIPPETS_DIR)) {
    console.log("No snippets/ directory. Skip.");
    return;
  }

  let uploaded = 0;
  let candidates = 0;

  // 팀원 폴더 모음
  const authors = fs
    .readdirSync(SNIPPETS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (DEBUG) console.log("[DEBUG] authors(found dirs):", authors);

  for (const authorDir of authors) {
    const email = EMAIL_MAP[authorDir];
    if (!email) {
      console.warn(`⚠️ Unknown author dir: ${authorDir}. Skip.`);
      continue;
    }

    const dirPath = path.join(SNIPPETS_DIR, authorDir);
    const files = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((f) => f.isFile())
      .map((f) => f.name)
      .filter((name) => /\.(md|txt|markdown)$/i.test(name));

    if (DEBUG) console.log("[DEBUG] author:", authorDir, "email:", email, "files:", files);

    for (const fname of files) {
      const full = path.join(dirPath, fname);
      const content = fs.readFileSync(full, "utf8");
      const createdAt = gitAuthorISODate(full) || new Date().toISOString();
      const title = inferTitleFromName(fname);

      const row = {
        author_email: email,
        content,
        created_at: createdAt,
        source: "github",
        title,
      };

      candidates += 1;
      console.log(`↗️ Uploading ${authorDir}/${fname} as ${email} @ ${createdAt}`);

      try {
        const out = await uploadSnippet(row);
        uploaded += 1;
        console.log("✅ Uploaded via n8n:", out);
      } catch (err) {
        console.error(`❌ Failed ${authorDir}/${fname}: ${err.message}`);
      }
    }
  }

  console.log(`Done. Candidates=${candidates}, Uploaded=${uploaded}.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
