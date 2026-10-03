// THE ACTUAL BUG, if rootMargin is the cause.
//
// `rootMargin:"0px 0px 15% 0px"` on the bottom EXPANDS the observer root
// downward: the trigger band ends 15% of a viewport height BELOW the fold. So a
// card reveals while it is still entirely off-screen, has finished its 500ms
// transition before the reader scrolls near it, and arrives already in colour —
// which looks exactly like "an immediate swap" even though a 500ms transition is
// declared and genuinely runs.
//
// The brief is "500ms AFTER entering the viewport", so the transition must
// START at viewport entry. That means the trigger band must be the real
// viewport (or slightly ABOVE it, never below).
//
// This measures, on a touch phone:
//   1. at load, how many figures are ALREADY revealed but still below the fold
//   2. of those, how many have already finished (i.e. reader will never see it)
//   3. for a card scrolled into view, WHEN the class is added relative to the
//      moment its top edge crossed the viewport bottom
import { chromium, devices } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const URL = "https://pinkpages.indigokarasu.com/?cb=" + Date.now();

const ctx = await b.newContext({ ...devices["Pixel 7"] });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);

const vp = p.viewportSize();

const atLoad = await p.evaluate(() => {
  const figs = [...document.querySelectorAll(".figure")];
  const vh = innerHeight;
  let revealedBelowFold = 0;
  let alreadySettledBelowFold = 0;
  const samples = [];
  for (const f of figs) {
    const r = f.getBoundingClientRect();
    if (r.top > vh) {
      // entirely below the fold
      if (f.classList.contains("revealed")) {
        revealedBelowFold++;
        const img = f.querySelector("img");
        const filt = img ? getComputedStyle(img).filter : null;
        if (filt === "none" || filt === undefined) alreadySettledBelowFold++;
        if (samples.length < 4)
          samples.push({ topBeyondFold: Math.round(r.top), filter: filt });
      }
    }
  }
  return {
    totalFigures: figs.length,
    viewportHeight: vh,
    revealedBelowFold,
    alreadySettledBelowFold,
    // the share of ALL figures that the reader will scroll into already-coloured
    pctRevealedOffscreen: figs.length
      ? +((revealedBelowFold / figs.length) * 100).toFixed(1)
      : 0,
    samples,
    rootMarginInUse: (() => {
      // read the actual observer config off the running page if it is exposed
      return window.__revealRootMargin ?? "(not exposed)";
    })(),
  };
});

// Timing: when does the class land relative to the card crossing the fold?
const timing = await p.evaluate(async () => {
  const figs = [...document.querySelectorAll(".figure")];
  const f = figs.find((x) => x.getBoundingClientRect().top > innerHeight * 1.2);
  if (!f) return { note: "no card far enough below the fold" };
  f.dataset.probe = "1";
  // Reset, then scroll until its top edge is a few px INSIDE the viewport.
  const y = Math.round(f.getBoundingClientRect().top + scrollY - innerHeight - 4);
  const t0 = performance.now();
  scrollTo(0, y);
  const r = f.getBoundingClientRect();
  await new Promise((res) => {
    const tick = () => {
      if (f.classList.contains("revealed")) return res();
      if (performance.now() - t0 > 3000) return res();
      requestAnimationFrame(tick);
    };
    tick();
  });
  return {
    classAddedAtMs: Math.round(performance.now() - t0),
    cardTopRelativeToViewport: Math.round(r.top),
    firedWhileStillBelowFold: r.top > 0,
    firedBeforeCardFullyVisible: r.top > 0,
  };
});

await b.close();
console.log(JSON.stringify({ atLoad, timing }, null, 2));
