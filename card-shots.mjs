// Save the three smallest cards as PNGs so they can be measured for real
// (the in-page canvas route is blocked by cross-origin taint).
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const DIR = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2";
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

const figs = p.locator(".figure");
const want = [40, 37, 78, 0];
const out = [];
for (const i of want) {
  const s = await figs.nth(i).screenshot();
  const f = `${DIR}/card-${i}.png`;
  writeFileSync(f, s);
  // The row's own text, so the file is identifiable without a browser.
  const title = await p.locator(".row").nth(i).locator(".title-e").first().innerText().catch(() => "?");
  out.push({ i, file: f, bytes: s.length, title: title.slice(0, 46) });
}
console.log(JSON.stringify(out, null, 2));
await b.close();
