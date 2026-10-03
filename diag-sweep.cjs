const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");
const SRC = "https://assets0.dostuffmedia.com/uploads/aws_asset/aws_asset/32527476/d13d6b01-f78f-49a9-a20b-bb0164fde5ca.jpg";

// Sweep at the REAL card size. The 200px lab flattered the filter: at 355px a
// 3px pitch is only ~3 screen periods across a face, so the screen itself
// becomes the signal. Hold the shadow/highlight dot ratio and scale the whole
// cell with pitch so the dots stay proportionally the same, then measure
// correlation to the source at matching geometry.
const cell = (pitch, r) => "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + pitch + '" height="' + pitch + '">'
  + '<rect width="' + pitch + '" height="' + pitch + '" fill="white"/>'
  + '<circle cx="' + pitch / 2 + '" cy="' + pitch / 2 + '" r="' + r + '" fill="black"/></svg>');

const RATIO = 0.48;   // highlight dot / shadow dot
const V = [2, 3, 4, 5, 6, 7, 8].map((p) => [p, +(p * 0.38).toFixed(2), +(p * 0.38 * RATIO).toFixed(2)]);
const nm = (v) => "w" + v[0];

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
  // Reference at the same geometry, unfiltered, so correlation is fair.
  const rows = '<img id="REF" src="' + SRC + '">'
    + V.map((v, i) => '<img src="' + SRC + '" style="filter:url(#f' + i + ')">').join("");
  await p.setContent('<!doctype html><html><head><style>body{margin:0;background:#fff}'
    + 'img{width:355px;height:123px;display:block}</style>'
    + '<svg width="0" height="0" aria-hidden="true"><defs>'
    + V.map((v, i) => def(i, v[0], v[1], v[2])).join("") + "</defs></svg></head><body>" + rows + "</body></html>");
  await p.waitForTimeout(3000);
  for (let i = -1; i < V.length; i++) {
    const label = i === -1 ? "REF" : nm(V[i]);
    const buf = await p.locator("img").nth(i + 1).screenshot();
    fs.writeFileSync("/tmp/sw_" + label + ".png", buf);
    console.log(label.padEnd(5) + String(buf.length).padStart(6) + "B");
  }
  await b.close();
})();
