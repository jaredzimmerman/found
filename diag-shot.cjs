const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
  await p.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
  await p.waitForSelector(".figure img", { timeout: 25000 });
  // Scroll so the first row of cards is in view, then wait for lazy loads.
  await p.evaluate(() => {
    const f = document.querySelector(".figure");
    f.scrollIntoView({ block: "center" });
  });
  await p.waitForTimeout(4000);

  // One card on its own, at 2x, so the dot screen is actually resolvable.
  const cards = p.locator(".figure");
  for (let i = 0; i < 3; i++) {
    const buf = await cards.nth(i).screenshot();
    fs.writeFileSync("/tmp/card_" + i + ".png", buf);
  }
  // And the region around the first three, with the text, to see it in context.
  const box = await cards.first().boundingBox();
  await p.screenshot({
    path: "/tmp/cards_ctx.png",
    clip: { x: box.x - 20, y: box.y - 90, width: box.width + 40, height: box.height + 200 },
  });
  console.log("captured 3 cards + context");
  await b.close();
})();
