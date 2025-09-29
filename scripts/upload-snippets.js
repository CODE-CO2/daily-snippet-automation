const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const API_URL = process.env.DAILY_SNIPPET_URL;
const API_KEY = process.env.DAILY_SNIPPET_API_KEY; // 헤더 + api_id 동시에 사용
const TEAM_NAME = process.env.TEAM_NAME || "7기-2팀";
const DEBUG = process.env.DEBUG === "1";

if (!API_URL) {
  console.error("❌ DAILY_SNIPPET_URL is missing");
  process.exit(1);
}
if (!API_KEY) {
  console.error("❌ DAILY_SNIPPET_API_KEY is missing");
  process.exit(1);
}

const ROOT = process.cwd();
const SNIPPETS_DIR = path.join(ROOT, "snippets");

// 폴더명 ↔ 이메일
const EMAIL_MAP = {
  eunho: "jeh0224@gachon.ac.kr",
  jieun: "wldms4849@gachon.ac.kr",
  siwan: "gamja5356@gachon.ac.kr",
  guebi: "guebi1220@gachon.ac.kr",
};

function ymdFromFilename(name) {
  const m = name.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function gitAuthorISODate(p) {
  try {
    return execSync(`git log -1 --pretty=format:%aI -- "${p}"`, {
      encoding: "utf8",
    }).trim() || null;
  } catch {
    return null;
  }
}

function isoToYmd(iso) {
  return (iso || "").split("T")[0] || null;
}

async function postSnippet(payload) {
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };

  if (DEBUG) {
    console.log("[DEBUG] POST", API_URL);
    console.log("[DEBUG] HEADERS", { ...headers, Authorization: "Bearer ****" });
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

  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, text };
  }
}

(async function main() {
  if (!fs.existsSync(SNIPPETS_DIR)) {
    console.error("❌ No snippets/ directory.");
    process.exit(2);
  }

  let candidates = 0,
    uploaded = 0;

  const authors = fs
    .readdirSync(SNIPPETS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const author of authors) {
    const userEmail = EMAIL_MAP[author];
    if (!userEmail) {
      console.warn(`⚠️ Skip: unknown author "${author}"`);
      continue;
    }

    const dir = path.join(SNIPPETS_DIR, author);
    const files = fs
      .readdirSync(dir)
      .filter((n) => /\.(md|txt|markdown)$/i.test(n));

    for (const fname of files) {
      const full = path.join(dir, fname);
      const content = fs.readFileSync(full, "utf8").trim();

      const ymdFromName = ymdFromFilename(fname);
      const createdIso = gitAuthorISODate(full) || new Date().toISOString();
      const snippet_date =
        ymdFromName || isoToYmd(createdIso) || new Date().toISOString().slice(0, 10);

      // ✅ API_ID 대신 API_KEY를 api_id로 사용
      const payload = {
        api_id: API_KEY,
        user_email: userEmail,
        snippet_date,
        content,
        team_name: TEAM_NAME,
      };

      candidates++;
      console.log(`↗️ ${author}/${fname} → ${userEmail} @ ${snippet_date}`);
      try {
        const out = await postSnippet(payload);
        uploaded++;
        console.log("✅ Uploaded:", out);
      } catch (e) {
        console.error(`❌ Failed ${author}/${fname}: ${e.message}`);
      }
    }
  }

  console.log(`Done. Candidates=${candidates}, Uploaded=${uploaded}.`);
  if (candidates === 0) process.exit(2);
  if (uploaded === 0) process.exit(3);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
