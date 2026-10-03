
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
    const prov = [...document.querySelectorAll(".prov")];
    const metaProv = rows.filter(r => {
      const m = r.querySelector(".meta");
      return m && /venue site|box office|listing/i.test(m.textContent||"");
    });
    return {
      cards: rows.length,
      provElements: prov.length,
      metaProvElements: metaProv.length,
      sampleRows: rows.slice(0,3).map(r => {
        const title = (r.querySelector(".row-title")||{}).textContent?.trim();
        const meta = r.querySelector(".meta")?.textContent?.trim() || "";
        return {title: title?.slice(0,40), meta};
      })
    };
  });
  console.log(JSON.stringify(r,null,2));
  await b.close();
})();
