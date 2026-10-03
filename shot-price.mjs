import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 1 });
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.mouse.move(2, 2);
await p.waitForTimeout(1500);

const check = await p.evaluate(() => {
  const prices = [...document.querySelectorAll(".price")].filter(e => e.offsetParent !== null);
  const texts = prices.map(e => e.textContent.trim());
  return {
    count: prices.length,
    anyNone: texts.filter(t => /^none$/i.test(t)).length,
    freeBadges: prices.filter(e => e.classList.contains("free")).length,
    samples: texts.slice(0, 8),
    longest: texts.reduce((a, t) => (t.length > a.length ? t : a), ""),
  };
});
console.log(JSON.stringify(check, null, 2));

await p.evaluate(() => window.scrollTo(0, 0));
await p.screenshot({ path: "shots/price-top.png" });
await p.evaluate(() => window.scrollTo(0, 900));
await p.waitForTimeout(500);
await p.screenshot({ path: "shots/price-mid.png" });
await b.close();
