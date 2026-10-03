
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
    args: ["--no-sandbox","--disable-dev-shm-usage"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  await p.goto("https://datebook.indigokarasu.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.waitForSelector(".row", { timeout: 25000 });
  await p.waitForTimeout(1000);
  const r = await p.evaluate(() => {
    const rows = [...document.querySelectorAll(".row")];
    const tagCount = {};
    let over = 0, withTags = 0;
    for (const r of rows) {
      const t = [...r.querySelectorAll(".tag")].map(x=>x.textContent.trim());
      if (t.length) withTags++;
      if (t.length > 2) over++;
      t.forEach(x => tagCount[x] = (tagCount[x]||0)+1);
    }
    const find = (re) => {
      const row = rows.find(r => re.test(r.textContent||""));
      if (!row) return null;
      return {
        title: (row.querySelector(".row-title")||{}).textContent?.trim().slice(0,60),
        desc: (row.querySelector(".desc")||row.querySelector(".blurb")||{}).textContent?.trim().slice(0,180),
        tags: [...row.querySelectorAll(".tag")].map(x=>x.textContent.trim()),
      };
    };
    return {
      cards: rows.length, withTags, over2: over, tagCount,
      saintHarison: find(/saint harison/i),
      ghosted: find(/ghosted/i),
    };
  });
  console.log(JSON.stringify(r,null,2));
  await b.close();
})();
