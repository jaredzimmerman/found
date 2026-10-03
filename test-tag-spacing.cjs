// Is there clear space between the description and the chip row, and between
// the chip row and whatever is above it?
//
// The defect this guards: `.tags` had a 5px `gap` between chips but NO margin,
// so the description's bottom edge and the chips' top edge were the same pixel
// in all six cards measured — a real 0px, not a tight-looking one. Worse, each
// chip carries `margin-top:-5.5px` as a hit-area expansion, so the chip's own
// border was pulled 5.5px ABOVE the tags box, into the last line of body text.
//
// So the gap that matters is between VISIBLE INK — the bottom of the description
// text and the top border of the first chip — not between the layout boxes. The
// chip's negative margin makes those two different measurements, and asserting
// the box gap alone would have passed while the borders still overlapped.
const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const URL = "https://datebook.indigokarasu.com/";

// The negative margin is a hit-area expansion, so the ink starts below the box.
const CHIP_INSET = 5.5;
const MIN_GAP_BELOW = 4;  // description -> chips
const MIN_GAP_ABOVE = 4;  // title/meta -> chips, on cards with no description

let fails = 0;
const check = (label, ok, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
};

(async () => {
  const b = await pw.chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox"] });
  const p = await b.newPage({ viewport: { width: 1185, height: 820 } });
  await p.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
  await p.waitForTimeout(2500);

  const r = await p.evaluate((inset) => {
    const rows = [];
    [...document.querySelectorAll("#list .row")].forEach((row, i) => {
      const tag = row.querySelector(".tag");
      const tags = row.querySelector(".tags");
      if (!tag || !tags) return;
      const t = tag.getBoundingClientRect();
      // The chip's VISIBLE border: its box shifted down by the negated margin.
      const inkTop = t.top + inset;
      const inkBottom = t.bottom - inset;
      const inkLeft = t.left;
      const colX = row.querySelector(".time-col").getBoundingClientRect().x;

      const desc = row.querySelector(".desc");
      const above = desc ? null : row.querySelector(".meta, .row-title, .title-e");

      rows.push({
        i,
        chipInkTop: +inkTop.toFixed(1),
        chipInkBottom: +inkBottom.toFixed(1),
        dxFromColumn: +(inkLeft - colX).toFixed(1),
        descBottom: desc ? +desc.getBoundingClientRect().bottom.toFixed(1) : null,
        aboveBottom: above ? +above.getBoundingClientRect().bottom.toFixed(1) : null,
        hasDesc: !!desc,
        hasAbove: !!above,
      });
    });
    return rows;
  }, CHIP_INSET);

  console.log(`\n== ${r.length} cards with chips ==`);

  const withDesc = r.filter((x) => x.hasDesc && x.descBottom != null);
  const below = withDesc.map((x) => +(x.chipInkTop - x.descBottom).toFixed(1));
  const badBelow = below.filter((g) => g < MIN_GAP_BELOW);
  check("chips clear the description below them", badBelow.length === 0,
    badBelow.length
      ? `${badBelow.length} cards under ${MIN_GAP_BELOW}px (min ${Math.min(...below)}px)`
      : `min ${Math.min(...below)}px, max ${Math.max(...below)}px over ${below.length} cards`);

  const noDesc = r.filter((x) => !x.hasDesc && x.hasAbove && x.aboveBottom != null);
  if (noDesc.length) {
    const above = noDesc.map((x) => +(x.chipInkTop - x.aboveBottom).toFixed(1));
    const badAbove = above.filter((g) => g < MIN_GAP_ABOVE);
    check("chips clear the line above them (cards with no description)", badAbove.length === 0,
      badAbove.length
        ? `${badAbove.length} cards under ${MIN_GAP_ABOVE}px (min ${Math.min(...above)}px)`
        : `min ${Math.min(...above)}px over ${above.length} cards`);
  } else {
    console.log("  --    no chip-only cards to check");
  }

  // The horizontal defect fixed alongside: the chip border used to hang 4px left
  // of the text column because the hit-area margin was applied on all sides.
  const off = r.filter((x) => Math.abs(x.dxFromColumn) > 0.6);
  check("chip left edge aligns with the text column", off.length === 0,
    off.length ? `${off.length} chips off by ${off[0].dxFromColumn}px` : `all ${r.length} flush`);

  await b.close();
  console.log(fails ? `\n${fails} FAILING` : "\nPASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });