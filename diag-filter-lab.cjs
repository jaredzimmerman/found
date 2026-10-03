const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");

// Render one real card photo through several filter variants and report each
// one's screenshot size. A blank card compresses to a few hundred bytes; a
// working screen is tens of KB. This is the measurement that killed filter v1.
const SRC = "https://assets0.dostuffmedia.com/uploads/aws_asset/aws_asset/32527476/d13d6b01-f78f-49a9-a20b-bb0164fde5ca.jpg";

const VARIANTS = [
  ["none", ""],
  ["grayscale", "grayscale(1) contrast(1.12)"],
  ["v1_broken", "url(#v1)"],
  ["v2_cell", "url(#v2)"],
  ["v3_invert", "url(#v3)"],
  ["v4_dotmask", "url(#v4)"],
];

// The halftone cell, a standalone 4x4 svg: white with a centred black dot.
// Referenced by feImage in v2 and v4.
const CELL = '<svg id="cell" width="4" height="4" viewBox="0 0 4 4">'
  + '<rect width="4" height="4" fill="#fff"/>'
  + '<circle cx="2" cy="2" r="1.5" fill="#000"/></svg>';

const DEFS = '<svg width="0" height="0" aria-hidden="true"><defs>'
  // v1: the original. feImage of a circle, luminanceToAlpha, and a discrete
  // table with 0 in the top bucket, so dark pixels are erased.
  + '<filter id="v1" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">'
  +   '<circle id="a1" cx="1" cy="1" r="2"/>'
  +   '<feImage width="3" height="3" xlink:href="#a1" result="t1"/>'
  +   '<feTile in="t1" result="d1"/>'
  +   '<feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="negLum"/>'
  +   '<feComponentTransfer in="negLum" result="thr">'
  +     '<feFuncA type="discrete" tableValues="0 0 0 0 0 0 0 0"/>'
  +   '</feComponentTransfer>'
  +   '<feMerge><feMergeNode in="d1"/><feMergeNode in="thr"/></feMerge>'
  + '</filter>'
  // v2: the cell pattern tiled, merged with a level-split source.
  + '<filter id="v2" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">'
  +   '<feImage width="4" height="4" xlink:href="#cell" result="ci"/>'
  +   '<feTile in="ci" result="cell"/>'
  +   '<feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="lumA"/>'
  +   '<feComponentTransfer in="lumA" result="lev">'
  +     '<feFuncA type="discrete" tableValues="0 0 0 0 1 1 1 1"/>'
  +   '</feComponentTransfer>'
  +   '<feMerge><feMergeNode in="cell"/><feMergeNode in="lev"/></feMerge>'
  + '</filter>'
  // v3: pure inversion through ink. Proves the plumbing works at all.
  + '<filter id="v3" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">'
  +   '<feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="lumA"/>'
  +   '<feComponentTransfer in="lumA" result="inv">'
  +     '<feFuncA type="table" tableValues="1 0"/>'
  +   '</feComponentTransfer>'
  +   '<feFlood flood-color="#000" result="ink"/>'
  +   '<feComposite in="ink" in2="inv" operator="in"/>'
  + '</filter>'
  // v4: dot mask with INVERTED alpha, so shadows get the big dots.
  + '<filter id="v4" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">'
  +   '<feImage width="4" height="4" xlink:href="#cell" result="ci"/>'
  +   '<feTile in="ci" result="cell"/>'
  +   '<feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="lumA"/>'
  +   '<feComponentTransfer in="lumA" result="inv">'
  +     '<feFuncA type="table" tableValues="1 0"/>'
  +   '</feComponentTransfer>'
  +   '<feComposite in="cell" in2="inv" operator="in" result="screened"/>'
  +   '<feMerge><feMergeNode in="screened"/></feMerge>'
  + '</filter>'
  + '</defs></svg>';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  console.log("source:", SRC);
  await p.setContent(
    '<!doctype html><html><head><style>body{margin:0;background:#fff}'
    + 'img{width:200px;height:70px;display:block;margin:2px}</style>'
    + DEFS + '</head><body>'
    + VARIANTS.map(([, f]) => '<img src="' + SRC + '" style="filter:' + f + '">').join("")
    + '</body></html>'
  );
  await p.waitForTimeout(1500);
  for (let i = 0; i < VARIANTS.length; i++) {
    const k = VARIANTS[i][0];
    const buf = await p.locator("img").nth(i).screenshot();
    fs.writeFileSync("/tmp/v_" + k + ".png", buf);
    console.log(k.padEnd(12) + " screenshot=" + String(buf.length).padStart(6) + "B");
  }
  await b.close();
})();
