// All cards, judged by pixel spread rather than byte size.
//
// The first sweep used "under 5000 bytes = blank" and produced a false positive:
// a very dark, low-detail photo (Tobi Lou, lumMean 3) compresses to ~3k PNG
// while being a perfectly real picture. Byte size measures entropy, not
// content. Spread measures content — a blank card is one flat value.
//
// Screenshots are written out and read back by png_lum.py, because the in-page
// canvas is tainted by cross-origin images.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const DIR = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/shots";
const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
const failed = [];
p.on("requestfailed", (r) => failed.push(r.url().slice(0, 80)));
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

const figs = p.locator(".figure");
const n = await figs.count();
const index = [];
for (let i = 0; i < n; i++) {
  const s = await figs.nth(i).screenshot({ timeout: 10000 });
  const f = `${DIR}/c${i}.png`;
  writeFileSync(f, s);
  const title = await p.locator(".row").nth(i).locator(".title-e").first().innerText().catch(() => "?");
  index.push({ i, f, bytes: s.length, title });
}
writeFileSync(`${DIR}/index.json`, JSON.stringify(index, null, 2));
console.log(JSON.stringify({ cards: n, requestFailed: failed.length, dir: DIR }, null, 2));
await b.close();
