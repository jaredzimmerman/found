const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");

// feImage/feTile produce a dot PATTERN but discard the source. To make the
// dots carry the photo's tone, the source must modulate the pattern. The only
// way to do that with a fixed dot cell is to blend the pattern with the source
// at a rate set by luminance — i.e. a DOT-MATRIX look, not a true variable-size
// halftone. Test that, plus the honest alternative: a coarse posterize + a
// dot overlay at low opacity, which reads as newsprint and cannot blank.
const SRC = "https://assets0.dostuffmedia.com/uploads/aws_asset/aws_asset/32527476/d13d6b01-f78f-49a9-a20b-bb0164fde5ca.jpg";

const CELL_URI = (p, r) => "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + p + '" height="' + p + '">'
  + '<rect width="' + p + '" height="' + p + '" fill="white"/>'
  + '<circle cx="' + p / 2 + '" cy="' + p / 2 + '" r="' + r + '" fill="black"/></svg>');

const TESTS = [
  ["t0_gray", "grayscale(1) contrast(1.12)"],
  // A: dot pattern multiplied by the INVERTED source alpha. Where the photo is
  // dark, inverted alpha is 1, so the dot survives; where light, it is erased.
  ["tA_mask", "url(#tA)"],
  // B: the dot pattern over a grayscale photo, dots at low opacity so the
  // photograph still carries the tone and the screen reads as newsprint.
  ["tB_overlay", "url(#tB)"],
  // C: the real thing — a variable-radius screen is not expressible in SVG
  // filter primitives, so approximate with a 2-level dot matrix: quantise the
  // source to 2 tones and screen each with its own dot size.
  ["tC_2level", "url(#tC)"],
];

const DEFS = '<svg width="0" height="0" aria-hidden="true"><defs>'
  + '<filter id="tA" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">'
  +   '<feImage href="' + CELL_URI(3, 1.2) + '" result="t"/>'
  +   '<feTile in="t" result="grid"/>'
  +   '<feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="lumA"/>'
  +   '<feComponentTransfer in="lumA" result="inv"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>'
  +   '<feComposite in="grid" in2="inv" operator="arithmetic" k1="1" k2="0" k3="1" k4="0"/>'
  + '</filter>'
  + '<filter id="tB" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">'
  +   '<feColorMatrix in="SourceGraphic" type="saturate" values="0" result="gray"/>'
  +   '<feComponentTransfer in="gray" result="inv">'
  +     '<feFuncR type="table" tableValues="1 0"/><feFuncG type="table" tableValues="1 0"/>'
  +     '<feFuncB type="table" tableValues="1 0"/><feFuncA type="table" tableValues="1 0"/>'
  +   '</feComponentTransfer>'
  +   '<feImage href="' + CELL_URI(3, 0.9) + '" result="t"/>'
  +   '<feTile in="t" result="grid"/>'
  +   '<feComposite in="inv" in2="grid" operator="in" result="screen"/>'
  +   '<feMerge><feMergeNode in="screen"/></feMerge>'
  + '</filter>'
  + '<filter id="tC" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">'
  // coarse big dots for the shadows
  +   '<feImage href="' + CELL_URI(3, 1.45) + '" result="tbig"/>'
  +   '<feTile in="tbig" result="big"/>'
  // fine small dots for the midtones
  +   '<feImage href="' + CELL_URI(3, 0.7) + '" result="tsml"/>'
  +   '<feTile in="tsml" result="sml"/>'
  +   '<feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="lumA"/>'
  +   '<feComponentTransfer in="lumA" result="inv"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>'
  // shadows: big dots
  +   '<feComposite in="big" in2="inv" operator="in" result="s1"/>'
  // highlights: small dots, gated on the source being light (NOT inverted)
  +   '<feComposite in="sml" in2="lumA" operator="in" result="s2"/>'
  +   '<feMerge><feMergeNode in="s1"/><feMergeNode in="s2"/></feMerge>'
  + '</filter>'
  + '</defs></svg>';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(
    '<!doctype html><html><head><style>body{margin:0;background:#fff}'
    + 'img{width:200px;height:70px;display:block;margin:1px}</style>'
    + DEFS + '</head><body>'
    + TESTS.map(([, f]) => '<img src="' + SRC + '" style="filter:' + f + '">').join("")
    + '</body></html>'
  );
  await p.waitForTimeout(1500);
  for (let i = 0; i < TESTS.length; i++) {
    const buf = await p.locator("img").nth(i).screenshot();
    fs.writeFileSync("/tmp/t_" + TESTS[i][0] + ".png", buf);
    console.log(TESTS[i][0].padEnd(12) + String(buf.length).padStart(6) + "B");
  }
  await b.close();
})();
