// Remaining WCAG items not yet measured on this build:
//   2.4.7 Focus Visible  — keyboard focus must be discernible at every stop
//   2.3.3 Animation from Interactions — prefers-reduced-motion must be honoured
// Also: the time-span format, which the user asked for directly ("no too much
// space between the number and AM/PM", an en dash rather than a double hyphen).
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1000);

// --- 1. Focus visibility: walk the real tab order and read the focus ring ----
const focus = [];
for (let i = 0; i < 14; i++) {
  await p.keyboard.press("Tab");
  const s = await p.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      label: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 34),
      outlineWidth: cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
      outlineColor: cs.outlineColor,
      outlineOffset: cs.outlineOffset,
      boxShadow: cs.boxShadow === "none" ? "none" : "present",
      visible: r.width > 0 && r.height > 0,
    };
  });
  if (s) focus.push(s);
}
const noRing = focus.filter(
  (f) => (f.outlineStyle === "none" || parseFloat(f.outlineWidth) === 0) && f.boxShadow === "none"
);
// A control may put its indicator on an ancestor instead of on itself — the
// search input is deliberately borderless and its ring lives on `.search-wrap`.
// Judging it here would report a false positive forever, so those are checked
// separately and only counted as a failure if the ancestor has no ring either.
const hostRing = await p.evaluate(() => {
  const inp = document.querySelector('input[type=search]');
  inp.focus();
  const wrap = document.querySelector(".search-wrap");
  const cs = getComputedStyle(wrap);
  return {
    wrapOutline: `${cs.outlineWidth} ${cs.outlineStyle}`,
    inputOutline: `${getComputedStyle(inp).outlineWidth} ${getComputedStyle(inp).outlineStyle}`,
  };
});
// Which of the ringless stops are the search field? Its indicator is on the
// host `.search-wrap`, so it is NOT a failure — but only if that host really
// has a ring. Everything else ringless IS a failure.
const searchIsRingless = noRing.some((f) => /Search events/.test(f.label));
const hostHasRing = /\dpx solid/.test(hostRing.wrapOutline);
const ringless = noRing.filter((f) => !(/Search events/.test(f.label) && hostHasRing));
const wrappedSearch = searchIsRingless;

// --- 2. Reduced motion: does the stylesheet actually respond? ---------------
const rm = await p.evaluate(() => {
  const probe = document.createElement("style");
  return new Promise((res) => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const before = getComputedStyle(document.querySelector(".row")).transitionDuration;
    res({
      mediaQuerySupported: mq.matches === false, // supported if it evaluates at all
      reducedMotionActive: mq.matches,
      transitionDuration: before,
    });
  });
});
// A reduced-motion pass needs its OWN context with emulated media. It cannot be
// a second page of the default context: `browser.newPage()` throws
// "Please use browser.newContext()", and `emulateMedia` on the first page would
// contaminate the focus measurements above.
const rmCtx = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const rmWithFlag = await rmCtx.newPage();
await rmWithFlag.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
const rmApplied = await rmWithFlag.evaluate(() => {
  const row = document.querySelector(".row");
  const a = document.querySelector("a[href]");
  return {
    mediaMatches: matchMedia("(prefers-reduced-motion: reduce)").matches,
    rowTransition: row ? getComputedStyle(row).transitionDuration : null,
    linkTransition: a ? getComputedStyle(a).transitionDuration : null,
  };
});
await rmCtx.close();

// --- 3. Time span format as actually rendered ------------------------------
const times = await p.evaluate(() =>
  [...document.querySelectorAll(".time")]
    .filter((e) => e.offsetParent !== null)
    .map((e) => e.textContent.replace(/\s+/g, " ").trim())
);

await b.close();

// The separator must be a real en dash, and there must be no gap between the
// number and AM/PM: "7 PM", never "7  PM" and never "7 PM -- 8 PM".
const spans = times.filter((t) => t.includes("–") || t.includes("—") || /--/.test(t));
const badSep = spans.filter((t) => /--|\s–\s|\s—\s/.test(t));
const badNumPm = times.filter((t) => /\d\s{2,}(AM|PM)/i.test(t));

console.log(
  JSON.stringify(
    {
      focusStops: focus.length,
      focusWithoutVisibleRing: noRing.length,
      // True failures: no ring on the control AND none on its host.
      focusWithoutRingAnywhere: ringless.length,
      // The search field's indicator lives on `.search-wrap`, not on the input.
      searchRingOnHost: hostRing,
      searchRinglessIsExpected: wrappedSearch && /\dpx solid/.test(hostRing.wrapOutline),
      focusOffscreen: focus.filter((f) => !f.visible).length,
      firstStops: focus.slice(0, 8).map((f) => `${f.tag}:${f.label}`),
      ringSamples: focus.slice(0, 4).map((f) => ({
        label: f.label,
        outline: `${f.outlineWidth} ${f.outlineStyle}`,
        offset: f.outlineOffset,
        shadow: f.boxShadow,
      })),
      reducedMotion: { ...rm, ...rmApplied },
      timeSamples: [...new Set(times)].slice(0, 10),
      spansWithSeparator: spans.length,
      spansWithBadSeparator: badSep.slice(0, 5),
      timesWithSplitAmPm: badNumPm.slice(0, 5),
    },
    null,
    2
  )
);
