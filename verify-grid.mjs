// The vision pass reported that the middle and right card columns are "shifted
// to the right and do not align with the left column's left edge". That may be
// a real column-count bug, or it may be the model describing a balanced masonry
// loosely. Measure the actual column x-positions of every card.
//
// NOTE: this script is deliberately self-contained. Every p.evaluate body
// defines its own helpers inside the function body — Playwright serialises the
// source, so helpers closed over from Node scope are undefined in the page and
// every reading after the first call is bogus.
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
await p.waitForTimeout(1400);

const out = await p.evaluate(() => {
  const vis = (e) => !!e && e.offsetParent !== null;
  const cards = [...document.querySelectorAll("article.row")].filter(vis);
  if (cards.length < 10) throw new Error("too few cards: " + cards.length);

  // Group every card by its left x, to recover the column count and positions.
  const byLeft = new Map();
  for (const c of cards) {
    const x = Math.round(c.getBoundingClientRect().left);
    if (!byLeft.has(x)) byLeft.set(x, []);
    byLeft.get(x).push(c);
  }
  const columnXs = [...byLeft.keys()].sort((a, b) => a - b);
  const columns = columnXs.map((x) => ({
    x,
    count: byLeft.get(x).length,
    right: Math.round(byLeft.get(x)[0].getBoundingClientRect().right),
  }));

  // The day list that holds them: its content box, and its own column CSS.
  const list = document.querySelector(".day-list");
  const lcs = list ? getComputedStyle(list) : null;
  const lr = list ? list.getBoundingClientRect() : null;

  // Per-column: how many cards, and the vertical gaps between consecutive cards.
  // `columnXs` holds the x values; `byLeft.get(x)` is the card list for that
  // column. (Destructuring `columns` as pairs was wrong — it holds objects.)
  const gapsByCol = columnXs.map((x) => {
    const els = byLeft.get(x);
    const sorted = els
      .map((e) => e.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(Math.round(sorted[i].top - sorted[i - 1].bottom));
    }
    return { x, count: els.length, gaps: [...new Set(gaps)].sort((a, b) => a - b) };
  });

  return {
    cardCount: cards.length,
    columnCount: columns.length,
    columns,
    container: lr
      ? { left: Math.round(lr.left), right: Math.round(lr.right), width: Math.round(lr.width) }
      : null,
    columnCountCss: lcs ? lcs.columnCount : null,
    columnGapCss: lcs ? lcs.columnGap : null,
    columnRuleCss: lcs ? lcs.columnRule : null,
    firstCardLeft: Math.round(cards[0].getBoundingClientRect().left),
    gapsByCol,
  };
});

await b.close();
console.log(JSON.stringify(out, null, 2));
