
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
    args: ["--no-sandbox","--disable-dev-shm-usage"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto("http://127.0.0.1:8899/index.html", { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".row", { timeout: 25000 });
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const rows = [...document.querySelectorAll(".row")];
    const freeRows = rows.filter(r => {
      const pr = r.querySelector(".time-price");
      return pr && pr.className.includes("free");
    });
    const one = freeRows[0];
    return {
      totalRows: rows.length,
      freeRows: freeRows.length,
      "time-col .price": rows.filter(r=>r.querySelector(".time-col .price")).length,
      ".time-price": rows.filter(r=>r.querySelector(".time-price")).length,
      sampleChildren: one ? [...(one.querySelector(".time-col")?.children||[])].map(c=>`[${c.className}] "${c.textContent.trim().slice(0,20)}"`) : null,
    };
  });
  console.log(JSON.stringify(r,null,2));
  await b.close();
})();
