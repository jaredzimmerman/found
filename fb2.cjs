
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
    const free = rows.filter(r => { const x = r.querySelector(".time-price"); return x && x.className.includes("free"); });
    const one = free[0];
    return {
      freeRows: free.length,
      freeBadgeText: one ? one.querySelector(".time-price").textContent.trim() : null,
      freeBadgeClass: one ? one.querySelector(".time-price").className : null,
      parentOfBadge: one ? (one.querySelector(".time-price").parentElement.className || one.querySelector(".time-price").parentElement.tagName) : null,
      rowStructure: one ? [...one.querySelector(".row-body")?.children||[]].map(c=>c.className||c.tagName) : null,
    };
  });
  console.log(JSON.stringify(r,null,2));
  await b.close();
})();
