// `.fbar-top input[type=search]:focus-visible{outline:none}` removes the ring
// from the search field. That is only acceptable if something else marks focus.
// The candidate is `.search-wrap:focus-within` darkening its bottom border.
// Measure BOTH states and judge the indicator on its own merits:
//
//   WCAG 2.2 SC 2.4.11 Focus Appearance (AAA) / 2.4.7 Focus Visible (AA)
//   - 2.4.7: the indicator must be discernible — some visible change.
//   - 2.4.11: the area must be at least a 2px thick perimeter around the
//     component, OR a 1px line with >=3:1 contrast against both adjacent
//     colours. A 1px grey->black underline can satisfy 2.4.7 while failing the
//     area requirement, and that distinction is the whole question here.
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
await p.mouse.move(2, 2);
await p.waitForTimeout(800);

const read = () =>
  p.evaluate(() => {
    const wrap = document.querySelector(".search-wrap");
    const inp = document.querySelector('input[type=search]');
    const wcs = getComputedStyle(wrap);
    const ics = getComputedStyle(inp);
    const paper = getComputedStyle(document.body).backgroundColor;
    return {
      active: document.activeElement === inp ? "search-input" : document.activeElement.tagName,
      wrapBorderBottom: {
        width: wcs.borderBottomWidth,
        style: wcs.borderBottomStyle,
        color: wcs.borderBottomColor,
      },
      // Everything else that could move on focus.
      // The WRAPPER's outline is the indicator under test. It was missing here
      // when I first wrote this script, so a fix applied to the wrapper read as
      // "no change" — the measurement, not the CSS, was the thing at fault.
      wrapOutline: `${wcs.outlineWidth} ${wcs.outlineStyle} ${wcs.outlineColor}`,
      wrapOutlineOffset: wcs.outlineOffset,
      wrapBoxShadow: wcs.boxShadow,
      wrapBorderTop: wcs.borderTopWidth,
      wrapHeight: Math.round(wrap.getBoundingClientRect().height),
      inputOutline: `${ics.outlineWidth} ${ics.outlineStyle} ${ics.outlineColor}`,
      inputBoxShadow: ics.boxShadow,
      paper,
    };
  });

const resting = await read();

// Focus it the way a keyboard user does, so :focus-visible actually engages.
// The blind Tab/Shift+Tab/Tab sequence walked PAST the input and landed on a
// BUTTON, so both readings were the resting state and the "change" I first
// reported was pure noise. Click it directly, and read the match states back
// so a missing indicator can be attributed to `:focus-visible` rather than to
// a field that never received focus.
await p.click('input[type=search]');
await p.waitForTimeout(400);
const focused = await read();
const matchStates = await p.evaluate(() => {
  const inp = document.querySelector('input[type=search]');
  return {
    isActiveElement: document.activeElement === inp,
    focus: inp.matches(":focus"),
    focusVisible: inp.matches(":focus-visible"),
    wrapFocusWithin: document.querySelector(".search-wrap").matches(":focus-within"),
  };
});

// --- contrast helper (WCAG relative luminance) ------------------------------
const lum = (rgb) => {
  const [r, g, b2] = rgb;
  return [r, g, b2]
    .map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
};
const ratio = (a, b2) => {
  const [x, y] = [lum(a), lum(b2)].sort((m, n) => n - m);
  return +((x + 0.05) / (y + 0.05)).toFixed(2);
};
const parse = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);

const paper = parse(resting.paper);
const restRatio = ratio(parse(resting.wrapBorderBottom.color), paper);
const focusRatio = ratio(parse(focused.wrapBorderBottom.color), paper);
const thickness = parseFloat(focused.wrapBorderBottom.width);

// 2.4.11: a 1px-perimeter indicator passes on contrast alone at >=3:1, but the
// area rule wants 2px. Record both so the verdict is not a judgement call.
//
// The indicator under test is the WRAPPER's outline. The input's own ring is
// deliberately suppressed (it is borderless by design) and the border colour is
// identical in both states, so neither of those can be carrying focus.
const ring = /(\d)px\s+(solid|dashed|dotted|double)/.exec(focused.wrapOutline || "");
const ringWidth = ring ? parseFloat(ring[1]) : 0;
const areaOk = ringWidth >= 2 || focusRatio >= 3;

await b.close();
console.log(
  JSON.stringify(
    {
      resting: { ...resting, borderVsPaper: restRatio },
      focused: { ...focused, borderVsPaper: focusRatio },
      matchStates,
      indicator: {
        kind: "wrapper outline (input ring removed by design)",
        wrapperOutline: focused.wrapOutline,
        wrapperOutlineOffset: focused.wrapOutlineOffset,
        ringWidthPx: ringWidth,
        borderThicknessPx: thickness,
        contrastVsPaper: focusRatio,
        borderChangesOnFocus: resting.wrapBorderBottom.color !== focused.wrapBorderBottom.color,
        outlineChangesOnFocus: resting.wrapOutline !== focused.wrapOutline,
        visible: ringWidth > 0,
        meets_2_4_11_area: areaOk,
      },
    },
    null,
    2
  )
);
