// Was my earlier "verified: mid-flight grayscale(0.124)" claim true?
//
// The trap: the filter lives on the IMG, the overlay on the FIGURE's ::after.
// A script that samples the overlay and reports it as the reveal has measured
// the clock that WAS already correct, and never looks at the img at all.
//
// So this measures BOTH, independently, and reports the pair. If they resolve
// at different times, the card visibly resolves twice and the shorter one
// reads as a snap.
//
// It also samples at fine granularity through the window and counts distinct
// filter values, which distinguishes a real interpolation from a value that
// merely READS as 500ms.
import { chromium, devices } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const URL = "https://pinkpages.indigokarasu.com/?cb=" + Date.now();

// Sample both the img filter and the ::after opacity across the reveal window.
const SAMPLER = `
  (sel) => {
    const f = document.querySelector(sel);
    if (!f) return null;
    const img = f.querySelector("img");
    const cs = getComputedStyle(img);
    return {
      revealed: f.classList.contains("revealed"),
      filter: cs.filter,
      afterOpacity: +getComputedStyle(f, "::after").opacity,
      filterDuration: cs.transitionDuration,
      filterProperty: cs.transitionProperty,
      afterDuration: getComputedStyle(f, "::after").transitionDuration,
    };
  }
`;

const ctx = await b.newContext({ ...devices["Pixel 7"] });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(900);

const vp = p.viewportSize();
const isPhone = await p.evaluate(() => matchMedia("(max-width:899px)").matches);

// Assert the stylesheet actually reaches the element. Read the COMPUTED
// transition on the img at rest — this is the number that governs the swap.
const resting = await p.evaluate((src) => eval(src)(".figure"), SAMPLER);

// Find a figure well below the fold and scroll it in.
const target = await p.evaluate(() => {
  const figs = [...document.querySelectorAll(".figure")];
  if (figs.length < 8) return null;
  const f = figs[6];
  f.dataset.probe = "1";
  const top = Math.round(f.getBoundingClientRect().top + scrollY);
  return { top, revealedBefore: f.classList.contains("revealed") };
});

let timeline = [];
let mid = null;
if (target) {
  await p.evaluate(() => scrollTo(0, 0));
  await p.waitForTimeout(200);
  await p.evaluate((y) => scrollTo(0, y), target.top - vp.height * 0.7);

  // Sample tightly: 25ms for ~900ms covers the whole window including both ends.
  const t0 = Date.now();
  while (Date.now() - t0 < 900) {
    const s = await p.evaluate(
      ([src, sel]) => eval(src)(sel),
      [SAMPLER, '[data-probe="1"]']
    );
    if (s) timeline.push({ ms: Date.now() - t0, ...s });
    await p.waitForTimeout(25);
  }
  // The exact mid-point, sampled once on its own.
  await p.evaluate(() => scrollTo(0, 0));
  await p.waitForTimeout(300);
  await p.evaluate((y) => scrollTo(0, y), target.top - vp.height * 0.7);
  await p.evaluate(() => {
    document.querySelectorAll(".figure.revealed").forEach((f) => f.classList.remove("revealed"));
  });
  await p.waitForTimeout(600);
  mid = await p.evaluate((src) => eval(src)('[data-probe="1"]'), SAMPLER);
  await p.waitForTimeout(800);
}

await b.close();

// Analyse: does the img filter interpolate, and do the two clocks agree?
const imgVals = [...new Set(timeline.map((s) => s.filter))];
const afterVals = [...new Set(timeline.map((s) => s.afterOpacity))];
const firstRevealed = timeline.find((s) => s.revealed) || null;

// When did each channel actually reach its end value?
const endFilter = timeline.length ? timeline[timeline.length - 1].filter : null;
const endAfter = timeline.length ? timeline[timeline.length - 1].afterOpacity : null;
const filterSettleMs =
  endFilter != null ? timeline.findLast?.((s) => s.filter === endFilter)?.ms : null;
const afterSettleMs =
  endAfter != null ? timeline.findLast?.((s) => s.afterOpacity === endAfter)?.ms : null;

console.log(
  JSON.stringify(
    {
      mediaMatches: isPhone,
      resting: {
        filter: resting.filter,
        filterDuration: resting.filterDuration,
        filterProperty: resting.filterProperty,
        afterDuration: resting.afterDuration,
      },
      targetFoundNotYetRevealed: target ? !target.revealedBefore : null,
      firstRevealedAtMs: firstRevealed ? firstRevealed.ms : null,
      settling: {
        imgFilterSettledAtMs: filterSettleMs,
        overlayOpacitySettledAtMs: afterSettleMs,
        sameClock: filterSettleMs === afterSettleMs,
      },
      interpolation: {
        distinctImgFilterValues: imgVals.length,
        distinctOverlayOpacities: afterVals.length,
        sample: imgVals.slice(0, 6),
      },
      midFlight: mid,
    },
    null,
    2
  )
);
