const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
  await p.waitForSelector(".row", { timeout: 20000 });
  await p.waitForTimeout(1500);

  const out = await p.evaluate(() => {
    const f = document.getElementById("halftone");
    const imgs = [...document.querySelectorAll(".figure img")];
    return {
      filterExists: !!f,
      tiles: f ? f.querySelectorAll("feTile").length : 0,
      dots: f ? f.querySelectorAll("circle").length : 0,
      merges: f ? f.querySelectorAll("feMergeNode").length : 0,
      n: imgs.length,
      filtered: imgs.filter((i) => getComputedStyle(i).filter.includes("halftone")).length,
      loaded: imgs.filter((i) => i.naturalWidth > 0).length,
      rect: (() => { const i = imgs[0]; const r = i.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
    };
  });
  console.log(JSON.stringify(out, null, 1));

  // THE decisive check: a filtered image must not paint a near-empty rect.
  // This is the measurement that killed the previous filter (637 bytes).
  const bytes = await p.evaluate(async () => {
    const shot = [];
    for (const i of [...document.querySelectorAll(".figure img")].slice(0, 8)) {
      i.scrollIntoView();
      await new Promise((r) => setTimeout(r, 60));
    }
    return null;
  });
  const buf = await p.locator(".figure img").first().screenshot();
  console.log("first filtered image screenshot bytes:", buf.length);
  await p.locator(".row").first().screenshot({ path: "/tmp/halftone-card.png" });
  await p.screenshot({ path: "/tmp/halftone-page.png" });
  await b.close();
})();
