// scripts/upload-snippets.js
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import fetch from "node-fetch"; // Node18+는 글로벌 fetch가 있지만 호환 위해 추가

const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");

// 팀원 폴더명 → 이메일 매핑
const EMAIL_MAP = {
  jieun: "jieun@example.com",  // 장지은(ENTJ) - 마케팅
  eunho: "jeh0224@gachon.ac.kr",  // 정은호(ISTJ) - 백엔드
  siwan: "siwan@example.com",  // 김시완(ENTP) - 프론트엔드
  gyubi: "gyubi@example.com"   // 이규비(INFJ) - 올라운더
};

const API_URL = process.env.DS_ENDPOINT || "https://gqfegtdjewnadcmksktg.supabase.co/rest/v1/snippets";
const API_KEY = process.env.DAILY_SNIPPET_API_KEY;

if (!API_KEY) {
  console.error("❌ DAILY_SNIPPET_API_KEY is missing");
  process.exit(1);
}

function gitAuthorISODate(filePath) {
  try {
    // 해당 파일의 '마지막 커밋 AuthorDate' (ISO8601, 타임존 포함)
    const cmd = `git log -1 --pretty=format:%aI -- "${filePath}"`;
    const out = execSync(cmd, { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

async function uploadSnippet(row) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "apikey": API_KEY,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
      // (중복 방지용 업서트가 필요하면)
      // "Prefer": "resolution=merge-duplicates"
    },
    // 업서트 사용 시 쿼리스트링 예: `${API_URL}?on_conflict=author_email,created_at`
    body: JSON.stringify(row)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} ${res.statusText}\n${text}`);
  }
  return res.json();
}

function inferTitleFromName(name) {
  const base = path.basename(name, path.extname(name));
  return `Daily note ${base}`;
}

async function main() {
  if (!fs.existsSync(SNIPPETS_DIR)) {
    console.log("No snippets/ directory. Skip.");
    return;
  }

  let uploaded = 0;

  const authors = fs.readdirSync(SNIPPETS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const authorDir of authors) {
    const email = EMAIL_MAP[authorDir];
    if (!email) {
      console.warn(`⚠️ Unknown author dir: ${authorDir} (no email mapping). Skip.`);
      continue;
    }

    const dirPath = path.join(SNIPPETS_DIR, authorDir);
    const files = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(f => f.isFile())
      .map(f => f.name)
      .filter(name => /\.(md|txt|markdown)$/i.test(name));

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
        title
      };

      console.log(`↗️ Uploading ${authorDir}/${fname} as ${email} @ ${createdAt}`);
      try {
        const out = await uploadSnippet(row);
        uploaded += 1;
        console.log(`✅ Uploaded:`, out);
      } catch (err) {
        console.error(`❌ Failed ${authorDir}/${fname}: ${err.message}`);
      }
    }
  }

  console.log(`Done. Uploaded ${uploaded} snippet(s).`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
