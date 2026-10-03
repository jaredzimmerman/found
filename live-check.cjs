// Prove the removal on the LIVE domain, not the local static server.

const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto("https://datebook.indigokarasu.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.waitForSelector(".row", { timeout: 25000 });
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const rows = [...document.querySelectorAll(".row")];
    return {
      cards: rows.length,
      prov: document.querySelectorAll(".prov").length,
      metaBadge: rows.filter(x => {
        const m = x.querySelector(".meta");
        return m && /venue site|box office|listing/i.test(m.textContent || "");
      }).length,
      sample: rows.slice(0, 2).map(x => {
        const m = x.querySelector(".meta");
        return {
          title: (x.querySelector(".row-title")||{}).textContent?.trim().slice(0,44),
          meta: m ? m.textContent.trim() : null,
        };
      }),
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
