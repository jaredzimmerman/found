const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const px = require("/usr/local/lib/hermes-agent/node_modules/pngjs");

// How dark is the source artwork? A canvas readback is blocked by CORS (the
// photos come off a different host), so each image is screenshotted in a bare
// page and the PNG is measured here in Node instead.
//
// This decides the contrast curve from data: if a meaningful share of the
// artwork sits below ~35/255 mean luma, any strong boost pushes it to solid
// black and the halftone has nothing left to print.
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 400, height: 300 } });

  const list = await p.goto("https://datebook.indigokarasu.com/", {
    waitUntil: "domcontentloaded", timeout: 45000 });
  await p.waitForSelector(".figure img", { timeout: 25000 });
  await p.waitForTimeout(1200);
  const srcs = await p.evaluate(() =>
    [...document.querySelectorAll(".figure img")].map((i) => i.currentSrc || i.src)
      .filter(Boolean));
  console.log("candidates:", srcs.length, "from", list && list.status());

  const luma = (buf) => {
    const png = px.PNG.sync.read(buf);
    const out = [];
    for (let i = 0; i < png.data.length; i += 4) {
      out.push(0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]);
    }
    return out;
  };

  const stats = [];
  const seen = new Set();
  for (const src of srcs) {
    if (seen.has(src) || stats.length >= 40) continue;
    seen.add(src);
    const res = await p.goto(src, { timeout: 30000 }).catch(() => null);
    if (!res || !res.ok()) continue;
    const g = luma(await p.screenshot());
    if (!g.length) continue;
    stats.push({
      mean: g.reduce((a, b) => a + b, 0) / g.length,
      min: Math.min(...g), max: Math.max(...g),
    });
  }

  stats.sort((a, b) => a.mean - b.mean);
  const q = (f) => stats[Math.floor(f * (stats.length - 1))].mean.toFixed(1);
  const below = (t) => stats.filter((s) => s.mean < t).length;
  console.log("images measured:", stats.length);
  console.log("source mean luma (0-255):");
  console.log(`  darkest ${q(0)}  p10 ${q(0.1)}  p25 ${q(0.25)}  median ${q(0.5)}  p75 ${q(0.75)}  brightest ${q(1)}`);
  console.log(`  mean < 60:  ${below(60)}/${stats.length}`);
  console.log(`  mean < 35:  ${below(35)}/${stats.length}  (a hard curve turns these solid black)`);
  console.log(`  range < 40: ${stats.filter((s) => s.max - s.min < 40).length}/${stats.length}  (already flat; contrast cannot help)`);
  await b.close();
})();