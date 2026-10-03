const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");

// Captures the live page in every theme, plus a hover state, so the themes can
// be LOOKED AT rather than inferred from computed style. Also measures the
// rendered dot lattice off the screenshot bytes: computed --dot-r is what the
// CSS declares, the measured pitch is what the reader actually sees.
const SITE = "https://datebook.indigokarasu.com/";
const OUT = "/root/.hermes/profiles/indigo/cache/scratch/shots";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox"] });
  const page = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector(".figure img", { timeout: 25000 });
  await page.waitForTimeout(2500);

  const themes = ["light", "dark", "pink"];
  for (const t of themes) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, t);
    await page.waitForTimeout(700);
    // Full page top: masthead + filter bar + first day of cards.
    await page.screenshot({ path: `${OUT}/desk-${t}.png` });
    // The actual page background, read from the element itself.
    const bg = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { bg: cs.backgroundColor, color: cs.color,
               varPaper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() };
    });
    console.log(`${t.padEnd(6)} body=${bg.bg}  text=${bg.color}  --paper=${bg.varPaper}`);
  }

  // Hover: the image must come back to full colour. Capture the same card
  // twice — at rest and hovered — so the difference is visible side by side.
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.waitForTimeout(500);
  const fig = page.locator(".figure").first();
  await fig.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const box = await fig.boundingBox();
  const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
  await page.screenshot({ path: `${OUT}/hover-rest.png`, clip });
  await fig.hover();
  await page.waitForTimeout(900); // past the 180ms transition
  const after = await fig.evaluate((f) => {
    const img = f.querySelector("img");
    return { imgFilter: getComputedStyle(img).filter,
             screenOpacity: getComputedStyle(f, "::after").opacity };
  });
  await page.screenshot({ path: `${OUT}/hover-on.png`, clip });
  console.log(`\nhover  img filter=${after.imgFilter}`);
  console.log(`hover  screen opacity=${after.screenOpacity}  (1 = screened, 0 = full colour)`);

  // Mobile, all three themes — the filter bar collapse is the known weak spot.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(800);
  for (const t of themes) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, t);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/phone-${t}.png` });
  }

  // Declared vs rendered dot geometry.
  const dots = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const f = document.querySelector(".figure");
    const a = getComputedStyle(f, "::after");
    return { declaredR: cs.getPropertyValue("--dot-r").trim(),
             opacity: cs.getPropertyValue("--dot").trim(),
             bgSize: a.backgroundSize, bgImage: a.backgroundImage.slice(0, 90) };
  });
  console.log(`\ndots   --dot-r=${dots.declaredR}  --dot=${dots.opacity}  cell=${dots.bgSize}`);

  await b.close();
  console.log(`\nshots in ${OUT}`);
})();
