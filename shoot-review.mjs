// Full-page captures for the visual review loop (criterion 6).
//
// Two things this fixes about the earlier shooting:
//   1. The pointer is parked AWAY from the page before the shot. The previous
//      run left it on a card, so `.row:hover` and `.figure:hover` were live and
//      the screenshot showed a hovered row as the resting design.
//   2. Fonts are awaited with `document.fonts.ready`. A shot taken before the
//      webfonts land shows the fallback stack, and a type-scale review of
//      fallback metrics is worthless — this is exactly the class of thing that
//      reads as "looks fine" when it is actually wrong.
import { chromium } from "playwright-core";

const URL = "https://pinkpages.indigokarasu.com/?cb=" + Date.now();
const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const views = [
  { name: "desktop-top", w: 1440, h: 1000, full: false, scroll: 0 },
  { name: "desktop-mid", w: 1440, h: 1000, full: false, scroll: 1100 },
  { name: "desktop-full", w: 1440, h: 1000, full: true, scroll: 0 },
  { name: "phone-top", w: 390, h: 844, full: false, scroll: 0 },
  { name: "phone-mid", w: 390, h: 844, full: false, scroll: 900 },
];

for (const v of views) {
  const p = await b.newPage({ viewport: { width: v.w, height: v.h } });
  await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await p.mouse.move(2, 2);
  await p.evaluate(() => document.fonts.ready);
  // Let halftone images settle and the entrance transitions finish.
  await p.waitForTimeout(1200);
  if (v.scroll) {
    await p.evaluate((y) => window.scrollTo(0, y), v.scroll);
    await p.waitForTimeout(400);
  }
  const path = `shots/${v.name}.png`;
  await p.screenshot({ path, fullPage: v.full });
  console.log("wrote", path);
  await p.close();
}

await b.close();
