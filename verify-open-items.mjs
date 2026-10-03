// Verify the two open items from the project's own summary, plus a stability
// diff. Everything is asserted geometrically against the LIVE site — no claims
// from reading CSS, because the two times I reported from reading CSS this
// project I reported a bug that did not exist.
//
//   A. Price is right-aligned on the card (both desktop grid and masonry flex)
//   B. Day headers are visually consistent (the vision pass saw one grey box,
//      one plain text — likely a sticky-header paint artifact or a real
//      difference in background)
//   C. Nothing else moved: live vs rule-neutralised must be identical
import { chromium } from "playwright-core";

const URL = "https://pinkpages.indigokarasu.com/";
const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });

async function load() {
  await p.goto(URL + "?cb=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  await p.mouse.move(2, 2); // park off-target: a hover rule changes the measurement
  await p.waitForTimeout(1200);
}
await load();

// ---- A. price alignment -------------------------------------------------
const price = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".row")].filter((r) => r.offsetParent !== null);
  const out = { rows: rows.length, checked: 0, offenders: [], inMasonry: 0, inRow: 0 };
  for (const r of rows) {
    const pr = r.querySelector(":scope > .price");
    if (!pr) continue;
    const rr = r.getBoundingClientRect();
    const prr = pr.getBoundingClientRect();
    if (prr.width === 0) continue;
    // is this row inside the masonry (.day-list) or a plain list?
    const inMasonry = !!r.closest(".day-list");
    inMasonry ? out.inMasonry++ : out.inRow++;
    // Right-aligned means: gap between price's right edge and row's right edge
    // is smaller than gap between price's left edge and row's left edge.
    const padRight = rr.right - prr.right;
    const padLeft = prr.left - rr.left;
    out.checked++;
    if (padRight > padLeft) {
      out.offenders.push({
        padRight: Math.round(padRight),
        padLeft: Math.round(padLeft),
        inMasonry,
        text: pr.textContent.trim(),
        parent: r.className,
      });
    }
  }
  out.ok = out.offenders.length === 0;
  return out;
});

// ---- B. day header consistency -----------------------------------------
const days = await p.evaluate(() => {
  const heads = [...document.querySelectorAll(".day-head")].filter((h) => h.offsetParent !== null);
  return heads.map((h) => {
    const cs = getComputedStyle(h);
    const first = h.querySelector(".day-name");
    return {
      text: (first ? first.textContent : h.textContent).trim().slice(0, 22),
      bg: cs.backgroundColor,
      borderBottom: cs.borderBottomWidth + " " + cs.borderBottomStyle + " " + cs.borderBottomColor,
      position: cs.position,
      top: cs.top,
      height: Math.round(h.getBoundingClientRect().height),
    };
  });
});
const bgSet = [...new Set(days.map((d) => d.bg))];
const borderSet = [...new Set(days.map((d) => d.borderBottom))];
const heights = [...new Set(days.map((d) => d.height))];

// ---- C. stability diff --------------------------------------------------
const snap = () =>
  p.evaluate(() => {
    const t = document.querySelector(".title-e");
    const v = document.querySelector(".venue");
    const bar = document.querySelector(".filters");
    return {
      titleY: t ? Math.round(t.getBoundingClientRect().top) : null,
      titleX: t ? Math.round(t.getBoundingClientRect().left) : null,
      venueY: v ? Math.round(v.getBoundingClientRect().top) : null,
      venueX: v ? Math.round(v.getBoundingClientRect().left) : null,
      barH: bar ? Math.round(bar.getBoundingClientRect().height) : null,
      scrollH: Math.round(document.documentElement.scrollHeight),
      rowCount: document.querySelectorAll(".row").length,
    };
  });

const before = await snap();
// Neutralise the two rules under test, then re-snapshot on the SAME DOM.
await p.addStyleTag({
  content: `.row>.price{justify-self:stretch !important;margin-left:0 !important}
            .day-list .row>.price{margin-left:0 !important;flex:1 1 auto !important}`,
});
await p.waitForTimeout(400);
const after = await snap();

await b.close();

const moved = Object.keys(before).filter((k) => before[k] !== after[k]);
console.log(
  JSON.stringify(
    {
      price,
      dayHeaders: { count: days.length, distinctBg: bgSet, distinctBorder: borderSet, distinctHeights: heights, days },
      stability: { before, after, movedKeys: moved, clean: moved.length === 0 },
    },
    null,
    2,
  ),
);
