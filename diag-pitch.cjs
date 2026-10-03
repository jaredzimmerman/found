const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");

const SRC = "https://assets0.dostuffmedia.com/uploads/aws_asset/aws_asset/32527476/d13d6b01-f78f-49a9-a20b-bb0164fde5ca.jpg";

// Candidate dot pitches. The image renders at 355px wide in a real card, so a
// 3-4px pitch is ~1% of the width; anything coarser aliases into solid fill at
// this raster. Finer = more newspaper-like but must stay above the sampling
// floor, so we measure rather than guess.
const PITCHES = [2, 3, 4, 6];

function cellSvg(p) {
  const r = p * 0.34; // dot radius as a fraction of the pitch
  return '<svg id="cell' + p + '" width="' + p + '" height="' + p + '" viewBox="0 0 '
    + p + ' ' + p + '">'
    + '<rect width="' + p + '" height="' + p + '" fill="#fff"/>'
    + '<circle cx="' + p / 2 + '" cy="' + p / 2 + '" r="' + r + '" fill="#000"/></svg>';
}

function filterSvg(p) {
  // The dot cell, tiled, used as a MASK. The source's inverted luminance is the
  // mask's alpha, so a dark pixel (high inverted alpha) keeps the dot and a
  // light one erases it. feComposite operator=in does the intersection.
  return '<filter id="h' + p + '" x="0%" y="0%" width="100%" height="100%" '
    + 'color-interpolation-filters="sRGB" filterUnits="objectBoundingBox">'
    + '<feImage width="' + p + '" height="' + p + '" xlink:href="#cell' + p + '" result="ci"/>'
    + '<feTile in="ci" result="grid"/>'
    + '<feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="lumA"/>'
    + '<feComponentTransfer in="lumA" result="inv">'
    + '<feFuncA type="table" tableValues="1 0"/>'
    + '</feComponentTransfer>'
    + '<feComposite in="grid" in2="inv" operator="in" result="dotsonly"/>'
    + '<feMerge><feMergeNode in="dotsonly"/></feMerge>'
    + '</filter>';
}

const VARIANTS = [["grayscale", "grayscale(1) contrast(1.12)"]]
  .concat(PITCHES.map((p) => ["h" + p, "url(#h" + p + ")"]));

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const cells = PITCHES.map(cellSvg).join("");
  const defs = '<svg width="0" height="0" aria-hidden="true"><defs>'
    + PITCHES.map(filterSvg).join("") + '</defs></svg>';
  await p.setContent(
    '<!doctype html><html><head><style>body{margin:0;background:#fff}'
    + 'img{width:355px;height:123px;display:block}</style>'
    + defs + '</head><body>' + cells
    + VARIANTS.map(([, f]) => '<img src="' + SRC + '" style="filter:' + f + '">').join("")
    + '</body></html>'
  );
  await p.waitForTimeout(1800);
  for (let i = 0; i < VARIANTS.length; i++) {
    const k = VARIANTS[i][0];
    const buf = await p.locator("img").nth(i).screenshot();
    fs.writeFileSync("/tmp/p_" + k + ".png", buf);
    console.log(k.padEnd(10) + " " + String(buf.length).padStart(6) + "B");
  }
  await b.close();
})();
