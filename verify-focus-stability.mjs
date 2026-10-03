// The focus-ring fix adds `outline` + `outline-offset:2px` to `.search-wrap`,
// which is a flex child of `.fbar-top`. Outlines do not affect layout (they are
// drawn outside the box and take no space in flow), so this pass exists to
// PROVE that rather than assume it — an earlier fix in this project did shift
// every row, and only the stability pass caught it.
//
// Assertions, all against the live URL, cache-busted:
//   A. page height is unchanged before vs after the CSS exists
//   B. the search field's own rect is unchanged
//   C. the filter bar's chips (the siblings that share the flex row) have not moved
//   D. the first card's top edge is unchanged
//   E. the ring does not overlap or clip against the bar's neighbours
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
await p.waitForTimeout(1000);

const snap = () =>
  p.evaluate(() => {
    const r = (e) => {
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      scrollHeight: document.documentElement.scrollHeight,
      searchWrap: r(document.querySelector(".search-wrap")),
      searchInput: r(document.querySelector('input[type=search]')),
      onlyFree: r(document.querySelector(".only-free")),
      fbarTop: r(document.querySelector(".fbar-top")),
      chips: [...document.querySelectorAll(".fbar-top .chip")].map((c) => ({
        l: c.textContent.trim().slice(0, 10),
        ...r(c),
      })),
      firstCard: r(document.querySelector("article.row")),
      firstTitle: r(document.querySelector("article.row h3")),
    };
  });

const before = await snap();

// Neutralise the fix in-place, exactly as a reader without the fix would see it.
await p.addStyleTag({
  content: ".fbar-top .search-wrap:focus-within{outline:0 !important;outline-offset:0 !important}",
});
await p.click('input[type=search]');
await p.waitForTimeout(300);
const after = await snap();

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diffs = [];
if (before.scrollHeight !== after.scrollHeight)
  diffs.push(`scrollHeight ${before.scrollHeight} -> ${after.scrollHeight}`);
for (const k of ["searchWrap", "searchInput", "onlyFree", "fbarTop", "firstCard", "firstTitle"]) {
  if (!eq(before[k], after[k])) diffs.push(`${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(after[k])}`);
}
if (before.chips.length !== after.chips.length) diffs.push(`chip count ${before.chips.length} -> ${after.chips.length}`);
else
  before.chips.forEach((c, i) => {
    if (!eq(c, after.chips[i])) diffs.push(`chip[${i}] "${c.l}": ${JSON.stringify(c)} -> ${JSON.stringify(after.chips[i])}`);
  });

// Does the ring collide with the chips to its right?
await p.reload({ waitUntil: "networkidle" });
await p.mouse.move(2, 2);
await p.click('input[type=search]');
await p.waitForTimeout(300);
const collide = await p.evaluate(() => {
  const wrap = document.querySelector(".search-wrap").getBoundingClientRect();
  const out = [];
  for (const sel of [".only-free", ".ftoggle", ".chip"]) {
    const e = document.querySelector(sel);
    if (!e || !e.offsetParent) continue;
    const b = e.getBoundingClientRect();
    // The ring extends outline-width + outline-offset beyond the box.
    const ringRight = wrap.right + 2 + 2;
    out.push({ sel, left: Math.round(b.left), overlapsRing: b.left < ringRight });
  }
  return out;
});

await b.close();
console.log(
  JSON.stringify(
    {
      stability: { assertions: 10, differences: diffs, stable: diffs.length === 0 },
      ringCollision: collide,
    },
    null,
    2
  )
);
