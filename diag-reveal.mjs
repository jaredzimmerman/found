// Diagnose, don't guess. Three specific questions, each of which has already
// produced a WRONG verdict from a harness that assumed instead of measured:
//
//   A. Is `.revealed` present on desktop at all? (last run said yes; watchFigures
//      early-returns above 899px, so it should be no)
//   B. Does `.row:hover img` actually match? The figure sits inside a wrapper
//      <div>, not as a direct child of <article class="row"> — a descendant
//      selector should still match, but "should" is what broke the last run.
//   C. Why does the interpolation sample read a flat line? Either the card was
//      already revealed, or the scroll did not move it, or getComputedStyle
//      is being read after the transition finished.
import { chromium, devices } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const URL = "https://pinkpages.indigokarasu.com/?cb=" + Date.now();

// ------------------------------------------------------------------ desktop
const dctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const dp = await dctx.newPage();
await dp.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await dp.waitForTimeout(1000);

const struct = await dp.evaluate(() => {
  const row = document.querySelector(".row");
  const fig = row && row.querySelector(".figure");
  const img = fig && fig.querySelector("img");
  return {
    rowTag: row ? row.tagName : null,
    rowClass: row ? row.className : null,
    figureInsideRow: !!(row && fig),
    // what is the figure's actual parent chain?
    parentChain: (() => {
      const out = [];
      let e = img;
      while (e && out.length < 6) {
        out.push(e.tagName.toLowerCase() + (e.className ? "." + e.className.split(" ")[0] : ""));
        e = e.parentElement;
      }
      return out;
    })(),
    // does the real hover selector match, per the engine itself?
    rowHoverMatchesImg: !!(row && img) ? (() => {
      try { return img.matches(".row:hover img"); } catch { return "err"; }
    })() : null,
    revealedCount: document.querySelectorAll(".figure.revealed").length,
    totalFigures: document.querySelectorAll(".figure").length,
    isPhoneWidth: matchMedia("(max-width:899px)").matches,
  };
});

// Hover a row that ACTUALLY has a figure. Index 0 does not (129 of 152 rows
// carry artwork), and hovering a figure-less row cannot possibly change a
// filter — which is how the previous run reported hover as broken.
const targetRowIndex = await dp.evaluate(() =>
  [...document.querySelectorAll(".row")].findIndex((r) => r.querySelector(".figure"))
);
const row = targetRowIndex >= 0 ? await dp.$$(".row").then((all) => all[targetRowIndex]) : null;
if (row) {
  await dp.evaluate(() => scrollTo(0, 0));
  await dp.mouse.move(2, 2);
  await dp.waitForTimeout(400);
  await row.scrollIntoViewIfNeeded();
  await dp.waitForTimeout(300);
  await row.hover();
  await dp.waitForTimeout(900);
}
const afterHover = await dp.evaluate(() => {
  // The first `.row` has NO `.figure` — only 129 of 152 rows carry artwork, so
  // `row.querySelector(".figure")` is null and the read throws. Hover a row that
  // actually HAS a figure, found by searching rather than by position.
  const row = [...document.querySelectorAll(".row")].find((r) => r.querySelector(".figure"));
  if (!row) return { error: "no row with a figure" };
  const fig = row.querySelector(".figure");
  const img = fig.querySelector("img");
  return {
    rowIndex: [...document.querySelectorAll(".row")].indexOf(row),
    rowMatchesHover: row.matches(":hover"),
    figMatchesHover: fig.matches(":hover"),
    filter: getComputedStyle(img).filter,
    filterDuration: getComputedStyle(img).transitionDuration,
  };
});

// ------------------------------------------------------------------- phone
const ctx = await b.newContext({ ...devices["Pixel 7"] });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);

const phoneDiag = await p.evaluate(async () => {
  const all = [...document.querySelectorAll(".figure")];
  const f = all.find(
    (x) => !x.classList.contains("revealed") && x.getBoundingClientRect().top > innerHeight * 1.3
  );
  if (!f) return { note: "no unrevealed card below the fold" };
  // Scroll it CLEARLY onto the screen, not just inside the band. A target of
  // `innerHeight - 60` leaves the card 60px BELOW the fold, so a band whose
  // bottom edge is above the fold legitimately never fires and the run reports
  // "no interpolation" for a transition that is working perfectly. The test has
  // to put the card where a reader's eye would be.
  const y = Math.round(f.getBoundingClientRect().top + scrollY - innerHeight * 0.6);
  // Instant scroll, then let layout + the observer settle before sampling.
  scrollTo(0, y);
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => setTimeout(r, 80));
  // Start sampling BEFORE the scroll: the transition begins the instant the
  // class lands, and a sample loop that starts afterwards catches only the
  // tail. `ms` must be relative to t0 — `Date.now()` is absolute, so every
  // sample came out as a 13-digit epoch and the timeline read as garbage.
  const t0 = performance.now();
  const series = [];
  const sample = () =>
    series.push({
      ms: Math.round(performance.now() - t0),
      revealed: f.classList.contains("revealed"),
      filter: getComputedStyle(f.querySelector("img")).filter,
      after: +getComputedStyle(f, "::after").opacity,
      top: Math.round(f.getBoundingClientRect().top),
    });
  for (let i = 0; i < 6; i++) {
    sample();
    await new Promise((r) => setTimeout(r, 20));
  }
  // (the scroll already happened above; this loop now only samples)
  for (let i = 0; i < 26; i++) {
    await new Promise((r) => setTimeout(r, 30));
    sample();
  }
  const distinct = [...new Set(series.map((x) => x.filter))];
  return {
    foldAt: innerHeight,
    firedAtTop: series.find((s) => s.revealed)?.top ?? null,
    firedOnScreen: (() => {
      const t = series.find((s) => s.revealed)?.top;
      return t == null ? null : t <= innerHeight;
    })(),
    distinctFilters: distinct.length,
    first: series[0],
    revealedAtMs: series.find((s) => s.revealed)?.ms ?? null,
    mid: series[Math.floor(series.length / 2)],
    last: series[series.length - 1],
  };
});

await b.close();
console.log(JSON.stringify({ desktopStruct: struct, desktopAfterHover: afterHover, phone: phoneDiag }, null, 2));
