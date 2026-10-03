
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
    const find = (re) => {
      const row = rows.find(r => re.test(r.textContent||""));
      if (!row) return null;
      return {
        title: (row.querySelector(".row-title")||{}).textContent?.trim(),
        desc: (row.querySelector(".desc")||row.querySelector(".blurb")||{}).textContent?.trim(),
        tags: [...row.querySelectorAll(".tag")].map(x=>x.textContent.trim()),
      };
    };
    return {
      saintHarison: find(/saint harison/i),
      ghosted: find(/ghosted/i),
      // also spot-check a known food event
      foodExample: find(/ferry building farmers market/i),
      // and a concert that mentions bar to prove it's NOT tagged food
      barExample: find(/tobi lou/i)
    };
  });
  console.log(JSON.stringify(r,null,2));
  await b.close();
})();
