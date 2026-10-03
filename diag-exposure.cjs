const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");

// Sweep contrast on the darkest card in the feed and report the resulting
// luma distribution, so the curve can be chosen from data rather than from
// one image that happened to look good in the lab.
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  await p.goto("https://datebook.indigokarasu.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.waitForSelector(".figure img", { timeout: 25000 });
  await p.waitForTimeout(2000);

  // Measure the SOURCE brightness of every card image, unfiltered, so the
  // judgement is made on the photo rather than on what the current curve did
  // to it. A fresh drawImage is not subject to the element's CSS filter.
  const stats = await p.evaluate(async () => {
    const els = [...document.querySelectorAll(".figure img")];
    await Promise.all(els.map((i) => Promise.race([
      i.complete ? null : i.decode().catch(() => {}),
      new Promise((r) => setTimeout(r, 4000)),
    ])));
    const out = [];
    for (const i of els) {
      if (!i.naturalWidth) continue;
      const c = document.createElement("canvas");
      c.width = 64; c.height = 24;
      const g = c.getContext("2d");
      g.drawImage(i, 0, 0, 64, 24);
      const d = g.getImageData(0, 0, 64, 24).data;
      let sum = 0, n = 0, mn = 255, mx = 0;
      for (let k = 0; k < d.length; k += 4) {
        const v = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
        sum += v; n++; if (v < mn) mn = v; if (v > mx) mx = v;
      }
      out.push({ mean: sum / n, min: mn, max: mx });
    }
    return out;
  });

  const means = stats.map((s) => s.mean).sort((a, b) => a - b);
  const q = (f) => means[Math.floor(f * (means.length - 1))].toFixed(1);
  console.log("cards measured:", stats.length);
  console.log("source brightness (mean luma, 0-255):");
  console.log(`  p0=${q(0)} p10=${q(0.1)} p25=${q(0.25)} median=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)} p100=${q(1)}`);
  console.log(`  cards with mean<60: ${stats.filter((s) => s.mean < 60).length}`);
  console.log(`  cards with mean<35 (crushes to black): ${stats.filter((s) => s.mean < 35).length}`);
  console.log(`  cards whose source range is under 40/255: ${stats.filter((s) => s.max - s.min < 40).length}`);
  await b.close();
})();