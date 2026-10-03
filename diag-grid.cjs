const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");

// The construction that measured corr=+0.949 against the source:
//   tiled dot cell  ×  (1 - luminance)  ->  the dots carry the tone.
// Now find the smallest dot that still scores well, since smaller dots were
// explicitly asked for and a coarser screen moires against the rule lines.
const SRC = "https://assets0.dostuffmedia.com/uploads/aws_asset/aws_asset/32527476/d13d6b01-f78f-49a9-a20b-bb0164fde5ca.jpg";

// (pitch, dotRadius) pairs, from coarse to fine.
const GRID = [
  [3, 1.45], [3, 1.2], [3, 1.0], [3, 0.85],
  [4, 1.6], [4, 1.3], [4, 1.1], [4, 0.9],
];

// Base64, not percent-encoding: encodeURIComponent emits %27 and %22, which
// are fine in a URL but the browser then refuses to decode the feImage href and
// silently renders nothing. Base64 has no characters that need escaping in an
// HTML attribute, so the reference actually resolves.
const cell = (p, r) => "data:image/svg+xml;base64," + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + p + '" height="' + p + '">'
  + '<rect width="' + p + '" height="' + p + '" fill="white"/>'
  + '<circle cx="' + p / 2 + '" cy="' + p / 2 + '" r="' + r + '" fill="black"/></svg>'
).toString("base64");

const defsFor = (p, r, i) =>
  '<filter id="g' + i + '" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">'
  + '<feImage href="' + cell(p, r) + '" result="t"/>'
  + '<feTile in="t" result="grid"/>'
  + '<feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="lumA"/>'
  + '<feComponentTransfer in="lumA" result="inv">'
  + '<feFuncA type="table" tableValues="1 0"/></feComponentTransfer>'
  + '<feComposite in="grid" in2="inv" operator="arithmetic" k1="1" k2="0" k3="1" k4="0"/>'
  + '</filter>';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const defs = '<svg width="0" height="0" aria-hidden="true"><defs>'
    + GRID.map((g, i) => defsFor(g[0], g[1], i)).join("") + '</defs></svg>';
  // Render at the real card width so the pitch is judged at real scale.
  await p.setContent(
    '<!doctype html><html><head><style>body{margin:0;background:#fff}'
    + 'img{width:355px;height:123px;display:block}</style>' + defs + '</head><body>'
    + GRID.map((g, i) => '<img src="' + SRC + '" style="filter:url(#g' + i + ')">').join("")
    + '</body></html>'
  );
  await p.waitForTimeout(1800);
  for (let i = 0; i < GRID.length; i++) {
    const name = "g" + GRID[i][0] + "_r" + GRID[i][1];
    const buf = await p.locator("img").nth(i).screenshot();
    fs.writeFileSync("/tmp/grid_" + name + ".png", buf);
    console.log(name.padEnd(12) + String(buf.length).padStart(6) + "B");
  }
  await b.close();
})();
