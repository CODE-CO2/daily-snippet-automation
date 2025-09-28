const DEBUG = true; // 임시로 켜기

// ... for (const fname of files) 안에서:
if (DEBUG) {
  console.log("[DEBUG] author:", authorDir, "email:", email);
  console.log("[DEBUG] file:", full);
  console.log("[DEBUG] payload:", row);
}

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const API_URL = process.env.DAILY_SNIPPET_URL;         // n8n 웹훅
if (!API_URL) { console.error("❌ DAILY_SNIPPET_URL is missing"); process.exit(1); }

const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");

const EMAIL_MAP = {
  jieun: "jieun@example.com",
  eunho: "jeh0224@gachon.ac.kr",
  siwan: "siwan@example.com",
  gyubi: "gyubi@example.com",
};

function gitAuthorISODate(filePath) {
  try { return execSync(`git log -1 --pretty=format:%aI -- "${filePath}"`, {encoding:"utf8"}).trim() || null; }
  catch { return null; }
}

async function uploadSnippet(row) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },  // ✅ n8n은 보통 이거면 충분
    body: JSON.stringify(row),
  });
  const text = await res.text();                      // n8n은 200/204 + 빈 응답일 수 있음
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}\n${text}`);
  try { return JSON.parse(text); } catch { return { ok: true, text }; }
}

function inferTitleFromName(name) {
  const base = path.basename(name, path.extname(name));
  return `Daily note ${base}`;
}

(async function main () {
  if (!fs.existsSync(SNIPPETS_DIR)) { console.log("No snippets/ directory. Skip."); return; }

  let uploaded = 0;
  const authors = fs.readdirSync(SNIPPETS_DIR, { withFileTypes:true })
    .filter(d => d.isDirectory()).map(d => d.name);

  for (const authorDir of authors) {
    const email = EMAIL_MAP[authorDir];
    if (!email) { console.warn(`⚠️ Unknown author dir: ${authorDir}. Skip.`); continue; }

    const dir = path.join(SNIPPETS_DIR, authorDir);
    const files = fs.readdirSync(dir, { withFileTypes:true })
      .filter(f => f.isFile()).map(f => f.name)
      .filter(n => /\.(md|txt|markdown)$/i.test(n));

    for (const fname of files) {
      const full = path.join(dir, fname);
      const content = fs.readFileSync(full, "utf8");
      const createdAt = gitAuthorISODate(full) || new Date().toISOString();
      const title = inferTitleFromName(fname);

      const row = { author_email: email, content, created_at: createdAt, source: "github", title };

      console.log(`↗️ Uploading ${authorDir}/${fname} as ${email} @ ${createdAt}`);
      try { const out = await uploadSnippet(row); uploaded++; console.log("✅ Uploaded via n8n:", out); }
      catch (e) { console.error(`❌ Failed ${authorDir}/${fname}: ${e.message}`); }
    }
  }
  console.log(`Done. Uploaded ${uploaded} snippet(s).`);
})().catch(e => { console.error(e); process.exit(1); });
