// Two questions the previous harness could not answer.
//
// 1. WHERE does the trigger now fire? Scroll in small steps from well below the
//    fold and record the card's top edge at the moment the class lands. With
//    `rootMargin:"0px 0px -10% 0px"` on a 1125px viewport the band ends ~112px
//    ABOVE the fold, so the expected answer is a top edge near +1013px — on
//    screen, not past it. Scrolling straight to one fixed offset and waiting
//    (the old harness) proves nothing: if that offset is outside the band the
//    class never arrives and a timeout reads as a pass.
//
// 2. WHICH rule actually supplies the 500ms? Two 0.5s declarations exist and
//    one of them sits inside `@supports not (mix-blend-mode:multiply)`, a
//    condition Chrome does NOT satisfy. If the effective 500ms is coming from
//    the block that is supposed to be dead, the reveal depends on a rule that
//    only wins by accident and will break on the next engine change.
//
// Also reports the DESKTOP duration, because the base rule says .18s and a
// stray .5s override there would silently change the hover feel.
import { chromium, devices } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const URL = "https://pinkpages.indigokarasu.com/?cb=" + Date.now();

// ---------------------------------------------------------------- phone
const ctx = await b.newContext({ ...devices["Pixel 7"] });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);

const supports = await p.evaluate(() => ({
  mixBlendMultiply: CSS.supports("mix-blend-mode", "multiply"),
  filterFn: CSS.supports("filter", "url(#x)"),
}));

const phoneCss = await p.evaluate(() => {
  const f = document.querySelector(".figure");
  const img = f.querySelector("img");
  const cs = getComputedStyle(img);
  return {
    filterDuration: cs.transitionDuration,
    filterProperty: cs.transitionProperty,
    afterDuration: getComputedStyle(f, "::after").transitionDuration,
  };
});

// Walk down the page in 25px steps, watching one card for the moment it reveals.
const trigger = await p.evaluate(async () => {
  const f = [...document.querySelectorAll(".figure")].find(
    (x) => x.getBoundingClientRect().top > innerHeight * 1.5
  );
  if (!f) return { note: "no card far enough below the fold" };
  const vh = innerHeight;
  const start = Math.round(f.getBoundingClientRect().top + scrollY);
  scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 250));

  let firedAt = null;
  for (let y = start - vh - 400; y < start + 40; y += 25) {
    scrollTo(0, y);
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 16));
    if (f.classList.contains("revealed")) {
      firedAt = { scrollY: y, top: Math.round(f.getBoundingClientRect().top) };
      break;
    }
  }
  return {
    viewportHeight: vh,
    foldAt: vh,
    firedAt,
    // Where it SHOULD fire: the band's bottom edge, pulled up by 10% of vh.
    expectedBandBottom: Math.round(vh * 0.9),
    firedOnScreen: firedAt ? firedAt.top <= vh : null,
    firedBeforeFold: firedAt ? firedAt.top > vh : null,
    leadTimePx: firedAt ? vh - firedAt.top : null,
  };
});

// ---------------------------------------------------------------- desktop
const dctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const dp = await dctx.newPage();
await dp.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await dp.waitForTimeout(900);
const desktopCss = await dp.evaluate(() => {
  const f = document.querySelector(".figure");
  const img = f.querySelector("img");
  const cs = getComputedStyle(img);
  return {
    filterDuration: cs.transitionDuration,
    filterProperty: cs.transitionProperty,
    afterDuration: getComputedStyle(f, "::after").transitionDuration,
    revealedCount: document.querySelectorAll(".figure.revealed").length,
  };
});

await b.close();
console.log(JSON.stringify({ supports, phoneCss, trigger, desktopCss }, null, 2));
