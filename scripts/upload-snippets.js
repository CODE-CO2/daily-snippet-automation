// scripts/upload-snippets.js  (CommonJS + Node18 global fetch)
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");

// 팀원 폴더명 → 이메일 매핑 (필요 시 수정)
const EMAIL_MAP = {
  jieun: "jieun@example.com",
  eunho: "jeh0224@gachon.ac.kr",
  siwan: "siwan@example.com",
  gyubi: "gyubi@example.com",
};

// ✅ 현재는 n8n 웹훅으로 설정되어 있음 (Supabase 직접 쓸 거면 아래 URL 교체)
const API_URL =
  process.env.DS_ENDPOINT ||
  "https://n8n.1000.school/webhook/0a43fbad-cc6d-4a5f-8727-b387c27de7c8";

// ⚠️ n8n이면 키가 필요 없을 수도 있음. 필요 없으면 이 블록을 제거하거나 optional로 바꿔.
// const API_KEY = process.env.DAILY_SNIPPET_API_KEY;
// if (!API_KEY) {
//   console.error("❌ DAILY_SNIPPET_API_KEY is missing");
//   process.exit(1);
// }

function gitAuthorISODate(filePath) {
  try {
    const cmd = `git log -1 --pretty=format:%aI -- "${filePath}"`;
    const out = execSync(cmd, { encoding: "utf8" }).trim();
    return out || null; // e.g., 2025-09-28T11:22:33+09:00
  } catch {
    return null;
  }
}

// ✅ 응답이 JSON이든 TEXT든 빈 바디든 안전하게 처리
async function parseResponse(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : { ok: true, empty: true };
  } catch {
    return { ok: true, text };
  }
}

async function uploadSnippet(row) {
  const headers = {
    "Content-Type": "application/json",
    // n8n이 헤더 검증하지 않는다면 아래 2줄은 지워도 됨
    // "Authorization": `Bearer ${API_KEY}`,
    // "apikey": API_KEY,
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload failed: ${res.status} ${res.statusText}\n${body}`);
  }
  return parseResponse(res);
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

  const authors = fs
    .readdirSync(SNIPPETS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const authorDir of authors) {
    const email = EMAIL_MAP[authorDir];
    if (!email) {
      console.warn(`⚠️ Unknown author dir: ${authorDir} (no email mapping). Skip.`);
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
        uploaded += 1;
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
