// The 500ms mobile reveal. A phone has no hover, so this is the ONLY route to a
// full-colour photograph there, and it cannot be verified by looking at a
// desktop screenshot.
//
// What this asserts, on a real touch context:
//   1. An off-screen figure starts screened (filter + halftone ::after opaque)
//   2. Scrolling it into view adds `.revealed` and the filter becomes `none`
//   3. The transition really is 500ms and actually interpolates — sampled
//      MID-transition, the filter must be neither the start nor the end value.
//      A `transition` that reads as 500ms but snaps instantly is a real failure
//      mode, and only a mid-flight sample catches it.
//   4. The halftone `::after` opacity moves in step with the filter
//   5. It is one-shot: scrolling away and back does NOT re-grey the image
//   6. Desktop is untouched — no `.revealed` at all at 1440px
//   7. Reduced motion collapses the duration to 0 but keeps the end state
import { chromium, devices } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const URL = "https://pinkpages.indigokarasu.com/?cb=" + Date.now();

const readFig = () =>
  p.evaluate(() => {
    const f = document.querySelector(".figure");
    if (!f) return null;
    const img = f.querySelector("img");
    const cs = getComputedStyle(img);
    const after = getComputedStyle(f, "::after");
    return {
      revealed: f.classList.contains("revealed"),
      filter: cs.filter,
      transition: cs.transitionProperty + " / " + cs.transitionDuration,
      afterOpacity: after.opacity,
      afterTransition: after.transitionProperty + " / " + after.transitionDuration,
      filterNone: cs.filter === "none",
    };
  });

// ---------------------------------------------------------------- touch phone
const ctx = await b.newContext({ ...devices["Pixel 7"] });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(800);

const isPhone = await p.evaluate(() => matchMedia("(max-width:899px)").matches);
const vp = p.viewportSize();

// The first figure is on screen at load, so it should already be revealed.
const onLoad = await readFig();

// Find a figure far below the fold, and scroll just enough to bring it in.
const target = await p.evaluate(() => {
  const figs = [...document.querySelectorAll(".figure")];
  if (figs.length < 8) return null;
  const f = figs[6];
  f.dataset.probe = "1";
  const r = f.getBoundingClientRect();
  return { top: Math.round(r.top + scrollY), revealed: f.classList.contains("revealed") };
});

let midFlight = null;
let after = null;
if (target) {
  await p.evaluate(() => scrollTo(0, 0));
  await p.waitForTimeout(200);
  // Scroll to a position where the target is just below/at the fold.
  await p.evaluate((y) => scrollTo(0, y), target.top - vp.height * 0.7);
  // Sample rapidly across the transition window.
  const samples = [];
  for (let i = 0; i < 14; i++) {
    samples.push(
      await p.evaluate(() => {
        const f = document.querySelector('[data-probe="1"]');
        if (!f) return null;
        const img = f.querySelector("img");
        const cs = getComputedStyle(img);
        return {
          t: Math.round(performance.now()),
          revealed: f.classList.contains("revealed"),
          filter: cs.filter,
          afterOpacity: +getComputedStyle(f, "::after").opacity,
        };
      })
    );
    if (i === 5) {
      midFlight = await p.evaluate(() => {
        const f = document.querySelector('[data-probe="1"]');
        const cs = getComputedStyle(f.querySelector("img"));
        return { filter: cs.filter, afterOpacity: +getComputedStyle(f, "::after").opacity };
      });
    }
    await p.waitForTimeout(60);
  }
  await p.waitForTimeout(700);
  after = await p.evaluate(() => {
    const f = document.querySelector('[data-probe="1"]');
    const img = f.querySelector("img");
    const cs = getComputedStyle(img);
    return {
      revealed: f.classList.contains("revealed"),
      filter: cs.filter,
      filterNone: cs.filter === "none",
      afterOpacity: +getComputedStyle(f, "::after").opacity,
    };
  });

  // One-shot: scroll far away, then back. It must NOT re-grey.
  await p.evaluate(() => scrollTo(0, 0));
  await p.waitForTimeout(400);
  const scrollAway = await p.evaluate(() => {
    const f = document.querySelector('[data-probe="1"]');
    return { revealed: f.classList.contains("revealed") };
  });
  await p.evaluate((y) => scrollTo(0, y), target.top - vp.height * 0.7);
  await p.waitForTimeout(300);
  var oneShot = await p.evaluate(() => {
    const f = document.querySelector('[data-probe="1"]');
    const cs = getComputedStyle(f.querySelector("img"));
    return {
      revealed: f.classList.contains("revealed"),
      stillColour: cs.filter === "none",
    };
  });
  var sampleCount = samples.filter((s) => s).length;
  var distinctFilters = [...new Set(samples.filter(Boolean).map((s) => s.filter))].length;
}

// ---------------------------------------------------------------- desktop
const dctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const dp = await dctx.newPage();
await dp.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await dp.waitForTimeout(700);
const desktop = await dp.evaluate(() => {
  const f = document.querySelector(".figure");
  return {
    isPhoneWidth: matchMedia("(max-width:899px)").matches,
    revealedCount: document.querySelectorAll(".figure.revealed").length,
    firstFilter: f ? getComputedStyle(f.querySelector("img")).filter : null,
  };
});

// ------------------------------------------------------- reduced motion (phone)
const rctx = await b.newContext({ ...devices["Pixel 7"], reducedMotion: "reduce" });
const rp = await rctx.newPage();
await rp.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await rp.waitForTimeout(700);
const reduced = await rp.evaluate(() => {
  const f = document.querySelector(".figure");
  if (!f) return null;
  const img = f.querySelector("img");
  return {
    revealed: f.classList.contains("revealed"),
    imgTransition: getComputedStyle(img).transitionDuration,
    afterTransition: getComputedStyle(f, "::after").transitionDuration,
    filterNone: getComputedStyle(img).filter === "none",
  };
});

await b.close();
console.log(
  JSON.stringify(
    {
      phone: {
        mediaMatches: isPhone,
        viewport: vp,
        firstFigureOnLoad: onLoad,
        targetFoundBeforeScroll: target && !target.revealed,
      },
      midFlightSample: midFlight,
      settled: after,
      oneShot: typeof oneShot === "undefined" ? null : oneShot,
      animationEvidence: typeof distinctFilters === "undefined" ? null : {
        samples: sampleCount,
        distinctFilterValues: distinctFilters,
        interpolated: distinctFilters > 2,
      },
      desktop,
      reducedMotion: reduced,
    },
    null,
    2
  )
);
