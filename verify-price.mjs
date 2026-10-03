// The `.row>.price` selectors were reported dead in an earlier pass, on a
// reading of 86 rows with zero direct children. The current build measures 139
// of 152 with a direct child. Before "fixing" anything, prove what the badge
// actually does: is it flush to the card's right edge, and does it sit on the
// same baseline as the time?
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
await p.waitForTimeout(1200);

const out = await p.evaluate(() => {
  const vis = (e) => !!e && e.offsetParent !== null;
  const rows = [...document.querySelectorAll("article.row")].filter(vis);
  const withPrice = rows.filter((r) => r.querySelector(":scope > .price"));

  // Right-alignment: distance from the badge's right edge to the card's right edge.
  const padRight = withPrice.map((r) => {
    const pr = r.querySelector(":scope > .price");
    return Math.round(r.getBoundingClientRect().right - pr.getBoundingClientRect().right);
  });

  // Baseline: the badge is a bordered box, so compare the text baselines via
  // the computed line box, not the box top (the border shifts the box).
  const baselineDelta = withPrice
    .map((r) => {
      const t = r.querySelector(".time");
      const pr = r.querySelector(":scope > .price");
      if (!t || !pr) return null;
      const tb = t.getBoundingClientRect();
      const pb = pr.getBoundingClientRect();
      // Bottom of the text content, ignoring the badge's 1px borders + padding.
      const pcs = getComputedStyle(pr);
      const padB = parseFloat(pcs.borderBottomWidth) + parseFloat(pcs.paddingBottom);
      return Math.round(tb.bottom - (pb.bottom - padB));
    })
    .filter((v) => v !== null);

  const stats = (arr) => {
    if (!arr.length) return { n: 0 };
    const s = [...arr].sort((a, b) => a - b);
    return {
      n: s.length,
      min: s[0],
      max: s[s.length - 1],
      distinct: [...new Set(s)].sort((a, b) => a - b),
    };
  };

  // Does the badge overlap the title, at any card width?
  const overlaps = withPrice.filter((r) => {
    const pr = r.querySelector(":scope > .price").getBoundingClientRect();
    const t = r.querySelector(".title-e, h3");
    if (!t) return false;
    const tb = t.getBoundingClientRect();
    return tb.right > pr.left && tb.top < pr.bottom && tb.bottom > pr.top;
  }).length;

  return {
    rowsTotal: rows.length,
    rowsWithDirectPrice: withPrice.length,
    rowsWithAnyPrice: rows.filter((r) => r.querySelector(".price")).length,
    rightPad: stats(padRight),
    baselineDelta: stats(baselineDelta),
    titleBadgeOverlaps: overlaps,
  };
});

await b.close();
console.log(JSON.stringify(out, null, 2));
