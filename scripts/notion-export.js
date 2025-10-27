"use strict";
// ... (중략: require, ENV, notionClient, helpers 등) ...

// ⭐ readBlocksAsText 함수와 queryPagesForDate 함수는 이전 수정 내용이 적용되어 있어야 합니다.

// ---------- helpers ----------
// ... (ensureDir, blockToPlain, readBlocksAsText 함수는 변경 없음) ...
// ... (queryPagesForDate 함수는 변경 없음) ...

// ---------- main ----------
(async function main() {
  ensureDir(SNIPPETS_DIR);
  ensureDir(CACHE_DIR);

  const pages = await queryPagesForDate(TARGET_DATE);

  if (!pages.length) {
    console.log(`[notion-export] No pages for ${TARGET_DATE}`);
    fs.writeFileSync(MAP_FILE, JSON.stringify({}, null, 2));
    return;
  }

  const grouped = {}; // key: `${email}|${date}` → { texts:[], pageIds:[] }

  for (const p of pages) {
    const props = p.properties || {};
    const date = (props?.Date?.date?.start || "").slice(0, 10);
    const email =
      props?.Email?.email ||
      (props?.Author?.people?.[0]?.person?.email || "").trim();

    if (!date || !email) {
      console.warn(`⚠️ Skip (missing date or email): ${p.id}`);
      continue;
    }

    const body = await readBlocksAsText(p.id);
    const key = `${email}|${date}`;
    if (!grouped[key]) grouped[key] = { texts: [], pageIds: [] };
    
    if (body) {
        grouped[key].texts.push(body);
    } else {
        console.warn(`⚠️ Empty body for page ID: ${p.id}`);
    }
    grouped[key].pageIds.push(p.id);
  }

  const mapOut = {};
  for (const key of Object.keys(grouped)) {
    const [email, date] = key.split("|");
    const folder = EMAIL_TO_FOLDER[email];
    if (!folder) { console.warn(`⚠️ Unknown email → folder: ${email}`); continue; }

    const dir = path.join(SNIPPETS_DIR, folder);
    ensureDir(dir);
    const file = path.join(dir, `${date}.txt`);

    if (fs.existsSync(file)) {
      console.log(`[notion-export] Exists, skip: ${file}`);
    } else {
      const merged = grouped[key].texts.filter(Boolean).join("\n\n---\n\n").trim();
      
      if (!merged) {
         console.warn(`⚠️ Skip file creation: No content merged for ${key}`);
         continue; 
      }
      
      // ⭐⭐⭐ 수정된 부분: title 생성 및 추가 로직을 제거합니다. ⭐⭐⭐
      // const title = `Daily Snippet - ${date} - ${email}`; // 제거
      // const content = [title, "=".repeat(title.length), "", merged].join("\n"); // 제거
      
      const content = merged; // merged 내용(순수 본문)만 사용
      
      fs.writeFileSync(file, content, "utf8");
      console.log(`[notion-export] Wrote: ${file}`);
    }

    mapOut[key] = grouped[key].pageIds;
  }

  fs.writeFileSync(MAP_FILE, JSON.stringify(mapOut, null, 2));
  console.log(`[notion-export] Map saved: ${MAP_FILE}`);
})().catch((e) => { console.error(e); process.exit(1); });
