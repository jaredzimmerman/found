// Every card, not just the first. A single sample can hide a bad row, and the
// whole page was blank before, so this sweeps all of them.
//
// Two distinct failures are being distinguished:
//   · blank at rest  -> a rendering bug (the filter erased it)
//   · blank only on hover -> a load bug (src never fetched)
import { chromium } from "playwright-core";

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
const rows = [];
// Screenshot each card; a blank one lands far under 5k, a photo far over.
for (let i = 0; i < n; i++) {
  try {
    const s = await figs.nth(i).screenshot({ timeout: 8000 });
    rows.push({ i, bytes: s.length, blank: s.length < 5000 });
  } catch (e) {
    rows.push({ i, bytes: -1, blank: true, err: String(e).slice(0, 60) });
  }
}
const blank = rows.filter((r) => r.blank);
const out = {
  cards: n,
  requestFailed: failed.length,
  blank: blank.length,
  minBytes: Math.min(...rows.map((r) => r.bytes)),
  maxBytes: Math.max(...rows.map((r) => r.bytes)),
  medianBytes: rows.map((r) => r.bytes).sort((a, b) => a - b)[Math.floor(n / 2)],
  blankIdx: blank.slice(0, 8).map((r) => r.i),
};
// Smallest few, to confirm the tail is a real (dark) photo and not a near-blank.
out.smallest = rows
  .slice()
  .sort((a, b) => a.bytes - b.bytes)
  .slice(0, 5)
  .map((r) => `${r.i}:${r.bytes}${r.blank ? " BLANK" : ""}`);

console.log(JSON.stringify(out, null, 2));
await b.close();
