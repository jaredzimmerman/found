// Regression guard for the two structural fixes.
//
// 1. TRIGGER: the reveal must begin while the card is ON SCREEN, never past the
//    fold. Walks down in steps and records the card's top edge at the moment the
//    class lands. A fixed-offset scroll + wait is not a test: if the offset is
//    outside the band the class never arrives and a timeout reads as a pass.
//    That is exactly how the 15% bottom rootMargin hid for so long.
//
// 2. SCOPING: the 500ms must be phone-only. The .18s belongs to pointer hover.
//    A top-level 0.5s rule silently overrode it on desktop, turning hover into a
//    half-second lag. Asserts 0.5s at 412px and 0.18s at 1440px.
//
// 3. RESTING STATE unchanged: the screened filter must still be present at rest
//    on both, or "moving the rule" broke the halftone look.
//
// 4. Both channels on one clock: img filter and ::after opacity must agree, or
//    the card visibly resolves twice.
import { chromium, devices } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const URL = "https://pinkpages.indigokarasu.com/?cb=" + Date.now();

async function css(p, unrevealedOnly = false) {
  return p.evaluate((onlyUn) => {
    // The FIRST figure is already revealed at load on a phone, so reading it
    // reports the post-reveal state and every "still screened at rest" check
    // fails for the wrong reason. Pick a card that has NOT revealed.
    const all = [...document.querySelectorAll(".figure")];
    const f = onlyUn
      ? all.find((x) => !x.classList.contains("revealed")) || all[0]
      : all[0];
    const img = f.querySelector("img");
    const cs = getComputedStyle(img);
    return {
      filter: cs.filter,
      filterDuration: cs.transitionDuration,
      afterDuration: getComputedStyle(f, "::after").transitionDuration,
      afterOpacity: +getComputedStyle(f, "::after").opacity,
      wasUnrevealed: onlyUn ? !f.classList.contains("revealed") : null,
    };
  }, unrevealedOnly);
}

// ------------------------------------------------------------------ phone
const ctx = await b.newContext({ ...devices["Pixel 7"] });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);

const phoneResting = await css(p, true);
const vh = (await p.viewportSize()).height;

const trigger = await p.evaluate(async () => {
  const f = [...document.querySelectorAll(".figure")].find(
    (x) => x.getBoundingClientRect().top > innerHeight * 1.5
  );
  if (!f) return { note: "no card far enough below the fold" };
  const start = Math.round(f.getBoundingClientRect().top + scrollY);
  scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 250));
  let firedAt = null;
  for (let y = start - innerHeight - 400; y < start + 40; y += 25) {
    scrollTo(0, y);
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 16));
    if (f.classList.contains("revealed")) {
      firedAt = { top: Math.round(f.getBoundingClientRect().top) };
      break;
    }
  }
  const vh = innerHeight;
  return {
    foldAt: vh,
    firedTop: firedAt ? firedAt.top : null,
    firedOnScreen: firedAt ? firedAt.top <= vh : null,
    firedPastFold: firedAt ? firedAt.top > vh : null,
    leadPx: firedAt ? vh - firedAt.top : null,
  };
});

// Does the 500ms actually interpolate on the img, sampled mid-flight?
const interp = await p.evaluate(async () => {
  // Pick a card well below the fold, and strip any .revealed so the sample
  // starts from the screened state. Selecting a card the observer had already
  // fired on yields a flat line of 1 distinct value, which reads as
  // "no interpolation" when the transition is in fact correct.
  const f = [...document.querySelectorAll(".figure")].find(
    (x) => x.getBoundingClientRect().top > innerHeight * 1.4
  );
  if (!f) return null;
  f.classList.remove("revealed");
  f.dataset.probe = "1";
  // Put the card CLEARLY on screen. Scrolling to `innerHeight - 100` leaves it
  // below the fold, where a band ending above the fold correctly never fires —
  // the test then reports "no interpolation" for a transition that is fine.
  const y = Math.round(f.getBoundingClientRect().top + scrollY - innerHeight * 0.6);
  scrollTo(0, y);
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => setTimeout(r, 60));
  const seen = new Set();
  const start = performance.now();
  while (performance.now() - start < 800) {
    seen.add(getComputedStyle(f.querySelector("img")).filter);
    await new Promise((r) => setTimeout(r, 20));
  }
  const vals = [...seen];
  return {
    distinct: vals.length,
    start: vals[0],
    mid: vals[Math.floor(vals.length / 2)],
    end: vals[vals.length - 1],
    endsAtNone: vals[vals.length - 1] === "none",
  };
});

// ---------------------------------------------------------------- desktop
const dctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const dp = await dctx.newPage();
await dp.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await dp.waitForTimeout(900);
const deskResting = await css(dp);
const deskHover = await (async () => {
  // hover() is a Playwright method — it cannot be called inside page.evaluate.
  // And the row to use is the first one that HAS a figure: only 129 of 152 rows
  // carry artwork, so `.row` index 0 has no `.figure` at all, and hovering it
  // cannot change an image filter. The previous run read
  // `document.querySelector(".figure")` — the document's first figure, which is
  // in a DIFFERENT card than the one hovered. Hover and read the SAME card.
  const idx = await dp.evaluate(() =>
    [...document.querySelectorAll(".row")].findIndex((r) => r.querySelector(".figure"))
  );
  if (idx < 0) return { error: "no row with a figure" };
  const rows = await dp.$$(".row");
  const row = rows[idx];
  if (!row) return { error: "row handle missing" };
  await dp.mouse.move(2, 2);
  await row.scrollIntoViewIfNeeded();
  await dp.waitForTimeout(300);
  await row.hover();
  await dp.waitForTimeout(800);
  return dp.evaluate((n) => {
    // Measure the figure inside the row that was actually hovered, not the
    // document's first one — they are not the same card, and reading the wrong
    // element is how a passing hover test reports a failure (and vice versa).
    const rows = document.querySelectorAll(".row");
    const row = rows[n];
    const f = row && row.querySelector(".figure");
    if (!f) return { error: "no figure in hovered row" };
    return {
      filterOnHover: getComputedStyle(f.querySelector("img")).filter,
      revealedCount: document.querySelectorAll(".figure.revealed").length,
    };
  }, idx);
})();

await b.close();

const V = {
  "phone: 500ms declared": phoneResting.filterDuration.startsWith("0.5s"),
  "phone: overlay on same 500ms clock": phoneResting.afterDuration === "0.5s",
  "phone: still screened at rest": /grayscale\(1\)/.test(phoneResting.filter),
  "phone: overlay opaque at rest": phoneResting.afterOpacity === 1,
  "reveal fires ON SCREEN, not past the fold": trigger.firedOnScreen === true,
  "reveal has lead time before the fold": (trigger.leadPx ?? 0) > 0,
  "img filter interpolates (not a snap)": (interp?.distinct ?? 0) > 3,
  "img filter ends at none": interp?.endsAtNone === true,
  "desktop: keeps 180ms hover, NOT 500ms": deskResting.filterDuration.startsWith("0.18s"),
  "desktop: overlay keeps 180ms": deskResting.afterDuration === "0.18s",
  "desktop: still screened at rest": /grayscale\(1\)/.test(deskResting.filter),
  "desktop: no reveal class at all": deskHover.revealedCount === 0,
  "desktop: hover still reveals": deskHover.filterOnHover === "none",
};const fails = Object.entries(V).filter(([, ok]) => !ok).map(([k]) => k);

console.log(
  JSON.stringify(
    { phoneResting, trigger, interpolation: interp, desktopResting: deskResting, desktopHover: deskHover, verdict: V, passed: Object.values(V).filter(Boolean).length, total: Object.keys(V).length, fails },
    null,
    2
  )
);
