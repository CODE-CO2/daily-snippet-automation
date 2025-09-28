const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// 기본 경로
const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");

// 팀원 폴더명 → 이메일 매핑
const EMAIL_MAP = {
  jieun: "jieun@example.com",
  eunho: "jeh0224@gachon.ac.kr",
  siwan: "siwan@example.com",
  gyubi: "gyubi@example.com",
};

// ✅ Secrets에서 주입받음
const API_URL = process.env.DAILY_SNIPPET_URL;
const API_KEY = process.env.DAILY_SNIPPET_API_KEY;

if (!API_URL) {
  console.error("❌ DAILY_SNIPPET_URL is missing");
  process.exit(1);
}
if (!API_KEY) {
  console.error("❌ DAILY_SNIPPET_API_KEY is missing");
  process.exit(1);
}

// 파일 마지막 커밋 시간
function gitAuthorISODate(filePath) {
  try {
    const cmd = `git log -1 --pretty=format:%aI -- "${filePath}"`;
    return execSync(cmd, { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

// 업로드 함수
async function uploadSnippet(row) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      apikey: API_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} ${res.statusText}\n${text}`);
  }
  return res.json().catch(() => ({})); // 응답이 비어도 안전 처리
}

// 제목 생성
function inferTitleFromName(name) {
  const base = path.basename(name, path.extname(name));
  return `Daily note ${base}`;
}

// 메인
(async function main() {
  if (!fs.existsSync(SNIPPETS_DIR)) {
    console.log("No snippets/ directory. Skip.");
    return;
  }

  let uploaded = 0;
  const authors = fs
    .readdirSync(SNIPPETS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

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

      console.log(`↗️ Uploading ${authorDir}/${fname} as ${email} @ ${createdAt}`);
      try {
        const out = await uploadSnippet(row);
        uploaded++;
        console.log("✅ Uploaded:", out);
      } catch (err) {
        console.error(`❌ Failed ${authorDir}/${fname}: ${err.message}`);
      }
    }
  }

  console.log(`Done. Uploaded ${uploaded} snippet(s).`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
