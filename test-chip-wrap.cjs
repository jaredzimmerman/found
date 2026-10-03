// When the chip row wraps onto a second line, do the two lines clear each other?
//
// `.tags` is `display:flex; flex-wrap:wrap; gap:5px`. A flex `gap` is a SINGLE
// value, so `gap:5px` means 5px on BOTH axes — the line-to-line spacing was
// already 5px, which sounds fine and is not what the eye sees. What the eye sees
// is the chip's BORDER, and each chip carries `margin:-5.5px 0` as a hit-area
// expansion. So every chip's visible box hangs 5.5px above and 5.5px below its
// own flex item, and those expansions OVERLAP: the bottom border of the row-1
// chip and the top border of the row-2 chip end up 5px - 5.5px - 5.5px apart,
// i.e. crossing by 6px.
//
// So the fix is NOT "increase the gap". Raising `gap` fights a negative margin
// that is 5.5px deep on each side, and any gap under about 11px leaves the
// borders touching. `row-gap` has to clear the two hit-area expansions.
//
// This asserts the border-to-border distance, not the flex gap, because the gap
// is the input to the bug, not the thing that is wrong.
const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const URL = "https://datebook.indigokarasu.com/";

const CHIP_INSET = 5.5;          // the chip's own negative margin, per side
const MIN_LINE_CLEARANCE = 6;    // px of paper between two rows of borders

let fails = 0;
const check = (label, ok, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
};

(async () => {
  const b = await pw.chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox"] });

  for (const vw of [1185, 1440, 390]) {
    console.log(`\n== ${vw}px ==`);
    const p = await b.newPage({ viewport: { width: vw, height: 900 } });
    await p.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
    await p.waitForTimeout(2500);

    const r = await p.evaluate((inset) => {
      const wrapped = [];
      [...document.querySelectorAll("#list .row")].forEach((row, i) => {
        const tags = row.querySelector(".tags");
        if (!tags) return;
        const chipEls = [...tags.querySelectorAll(".tag")];
        if (chipEls.length < 2) return;

        // Group chips into visual rows by their own top edge.
        const boxes = chipEls.map((c) => {
          const b = c.getBoundingClientRect();
          return { top: b.top, bottom: b.bottom, left: b.left, right: b.right,
                   inkTop: b.top + inset, inkBottom: b.bottom - inset,
                   txt: c.textContent.trim().slice(0, 16) };
        });
        const lines = [];
        for (const bx of boxes) {
          const line = lines.find((l) => Math.abs(l.top - bx.top) < 2);
          if (line) line.items.push(bx);
          else lines.push({ top: bx.top, bottom: bx.bottom, items: [bx] });
        }
        if (lines.length < 2) return;

        // Worst (smallest) clearance between consecutive rows of BORDERS.
        let worst = Infinity, pair = null;
        for (let k = 1; k < lines.length; k++) {
          const above = lines[k - 1], below = lines[k];
          const aboveInk = Math.max(...above.items.map((x) => x.inkBottom));
          const belowInk = Math.min(...below.items.map((x) => x.inkTop));
          const c = +(belowInk - aboveInk).toFixed(1);
          if (c < worst) {
            worst = c;
            pair = [above.items[0].txt, below.items[0].txt];
          }
        }
        wrapped.push({ i, lines: lines.length, worst, pair, chips: chipEls.length });
      });
      return { wrapped, total: document.querySelectorAll("#list .row .tag").length };
    }, CHIP_INSET);

    console.log(`  ${r.wrapped.length} cards wrap their chips onto a second line (of ${r.total} chips)`);
    const bad = r.wrapped.filter((x) => x.worst < MIN_LINE_CLEARANCE);
    check("every wrapped chip row clears the row above it", bad.length === 0,
      bad.length
        ? `${bad.length} cards under ${MIN_LINE_CLEARANCE}px (min ${Math.min(...bad.map((x) => x.worst))}px, e.g. "${bad[0].pair[0]}" / "${bad[0].pair[1]}")`
        : `min clearance ${Math.min(...r.wrapped.map((x) => x.worst))}px over ${r.wrapped.length} cards`);

    await p.close();
  }

  await b.close();
  console.log(fails ? `\n${fails} FAILING` : "\nPASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });