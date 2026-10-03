const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");
const SRC = "https://assets0.dostuffmedia.com/uploads/aws_asset/aws_asset/32527476/d13d6b01-f78f-49a9-a20b-bb0164fde5ca.jpg";

// THE WORKING CONSTRUCTION, with the dot pitch now a parameter.
//
// Why the earlier sweep produced six identical files: it used
// `feComposite operator="arithmetic"`. Chromium silently drops the whole filter
// when arithmetic over an feImage/feTile result misbehaves, and an img whose
// filter fails to resolve renders as the unfiltered image — so every variant
// hashed the same. The measured-good construction (corr +0.949) instead uses
// `operator="in"` twice, once per dot size, over two independently tiled
// layers. That is the version to ship; only the pitch changes here.
const cell = (pitch, r) => "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + pitch + '" height="' + pitch + '">'
  + '<rect width="' + pitch + '" height="' + pitch + '" fill="white"/>'
  + '<circle cx="' + pitch / 2 + '" cy="' + pitch / 2 + '" r="' + r + '" fill="black"/></svg>');

// pitch, shadowDot, highlightDot. The highlight dot must stay clearly SMALLER
// than the shadow dot, or the two layers merge into one flat screen and the
// tone range collapses — that is the whole mechanism.
const V = [
  [3, 1.15, 0.55],   // was 3 / 1.45 / 0.7  -> smaller
  [2, 0.95, 0.45],
  [4, 1.35, 0.7],
  [3, 0.95, 0.42],   // smallest at 3px pitch
  [5, 1.6, 0.85],
];
const name = (v) => "p" + v[0] + "_s" + v[1] + "_h" + v[2];

const def = (i, pitch, rs, rh) =>
  '<filter id="f' + i + '" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">'
  + '<feImage href="' + cell(pitch, rs) + '" result="tS"/>'
  + '<feTile in="tS" result="sh"/>'
  + '<feImage href="' + cell(pitch, rh) + '" result="tH"/>'
  + '<feTile in="tH" result="hl"/>'
  + '<feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="lumA"/>'
  + '<feComponentTransfer in="lumA" result="inv"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>'
  + '<feComposite in="sh" in2="inv" operator="in" result="s1"/>'
  + '<feComposite in="hl" in2="lumA" operator="in" result="s2"/>'
  + '<feMerge><feMergeNode in="s1"/><feMergeNode in="s2"/></feMerge>'
  + '</filter>';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent('<!doctype html><html><head><style>body{margin:0;background:#fff}'
    + 'img{width:355px;height:123px;display:block}</style>'
    + '<svg width="0" height="0" aria-hidden="true"><defs>'
    + V.map((v, i) => def(i, v[0], v[1], v[2])).join("") + "</defs></svg>"
    + '</head><body>' + V.map((v, i) =>
      '<img src="' + SRC + '" style="filter:url(#f' + i + ')">').join("")
    + '</body></html>');
  await p.waitForTimeout(2500);
  for (let i = 0; i < V.length; i++) {
    const buf = await p.locator("img").nth(i).screenshot();
    fs.writeFileSync("/tmp/hf_" + name(V[i]) + ".png", buf);
    console.log(name(V[i]).padEnd(16) + String(buf.length).padStart(6) + "B");
  }
  await b.close();
})();
