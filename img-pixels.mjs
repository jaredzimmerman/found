// Inspect card 40 specifically: is it a near-white photo, or a blank?
//
// Byte size alone cannot separate the two, so this measures the actual pixel
// statistics of the screenshot. A real photo of a pale subject has a wide
// luminance spread; a blank card is a single flat value.
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
await p.goto(`https://pinkpages.indigokarasu.com/?cb=${Date.now()}`, { waitUntil: "networkidle" });
await p.waitForSelector(".figure img");
await p.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 110));
  }
  window.scrollTo(0, 0);
});
await p.waitForFunction(() => [...document.querySelectorAll(".figure img")].every((i) => i.complete), { timeout: 30000 });
await p.waitForTimeout(1200);

const out = await p.evaluate(async () => {
  const idxs = [40, 37, 78];
  const imgs = [...document.querySelectorAll(".figure img")];
  const rows = [];
  for (const i of idxs) {
    const img = imgs[i];
    if (!img) { rows.push({ i, err: "missing" }); continue; }
    // Draw the image to a canvas and read luminance stats. The on-page element
    // is filtered; the canvas reads the raw bitmap, which is the question here
    // — is there a photo at all.
    const c = document.createElement("canvas");
    c.width = 216; c.height = 75;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let min = 255, max = 0, sum = 0, n = 0;
    const hist = new Set();
    for (let k = 0; k < d.length; k += 4) {
      const l = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
      if (l < min) min = l;
      if (l > max) max = l;
      sum += l; n++;
      hist.add(Math.round(l / 8));
    }
    rows.push({
      i,
      src: img.currentSrc || img.src.slice(0, 70),
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      lumMin: Math.round(min), lumMax: Math.round(max),
      lumMean: Math.round(sum / n),
      spread: Math.round(max - min),
      distinctBands: hist.size,
    });
  }
  return rows;
});

console.log(JSON.stringify(out, null, 2));
await b.close();
