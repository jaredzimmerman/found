const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");

// Isolate the failure. Each step tests one assumption, so we find which one is
// false rather than guessing at a whole filter.
//   s1  feImage of an inline <circle> in the SAME svg      -> does feImage work at all?
//   s2  feImage of an <svg id> in the same document        -> can it reference another element?
//   s3  feTile of s1                                       -> does tiling work?
//   s4  feTile then composite with an opaque flood         -> is the grid visible on white?
//   s5  the cell as a data: URI inside the filter          -> self-contained, no cross-ref
const SRC = "https://assets0.dostuffmedia.com/uploads/aws_asset/aws_asset/32527476/d13d6b01-f78f-49a9-a20b-bb0164fde5ca.jpg";

const CELL_URI = "data:image/svg+xml;utf8,"
  + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">'
    + '<rect width="4" height="4" fill="white"/>'
    + '<circle cx="2" cy="2" r="1.4" fill="black"/></svg>');

const STEPS = [
  ["s0_plain", ""],
  ["s1_feImage_circle", "url(#s1)"],
  ["s2_feImage_svgref", "url(#s2)"],
  ["s3_tile", "url(#s3)"],
  ["s4_tile_flood", "url(#s4)"],
  ["s5_datauri", "url(#s5)"],
];

const DEFS = '<svg width="0" height="0" aria-hidden="true"><defs>'
  + '<circle id="circ" cx="2" cy="2" r="1.4"/>'
  + '<svg id="cellref" width="4" height="4">'
  +   '<rect width="4" height="4" fill="white"/><circle cx="2" cy="2" r="1.4" fill="black"/></svg>'
  // s1: feImage of a circle element, same svg
  + '<filter id="s1" x="0%" y="0%" width="100%" height="100%">'
  +   '<feImage width="4" height="4" xlink:href="#circ"/></filter>'
  // s2: feImage of a nested svg element, same svg
  + '<filter id="s2" x="0%" y="0%" width="100%" height="100%">'
  +   '<feImage width="4" height="4" xlink:href="#cellref"/></filter>'
  // s3: tile the circle
  + '<filter id="s3" x="0%" y="0%" width="100%" height="100%">'
  +   '<feImage width="4" height="4" xlink:href="#circ" result="t"/>'
  +   '<feTile in="t"/></filter>'
  // s4: tile, then flood black through the grid's alpha
  + '<filter id="s4" x="0%" y="0%" width="100%" height="100%">'
  +   '<feImage width="4" height="4" xlink:href="#circ" result="t"/>'
  +   '<feTile in="t" result="grid"/>'
  +   '<feFlood flood-color="black" result="ink"/>'
  +   '<feComposite in="ink" in2="grid" operator="in"/></filter>'
  // s5: same as s4 but the cell comes from a data: URI
  + '<filter id="s5" x="0%" y="0%" width="100%" height="100%">'
  +   '<feImage href="' + CELL_URI + '" result="t"/>'
  +   '<feTile in="t" result="grid"/>'
  +   '<feFlood flood-color="black" result="ink"/>'
  +   '<feComposite in="ink" in2="grid" operator="in"/></filter>'
  + '</defs></svg>';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(
    '<!doctype html><html><head><style>body{margin:0;background:#eee}'
    + 'img{width:200px;height:70px;display:block;margin:1px}</style>'
    + DEFS + '</head><body>'
    + STEPS.map(([, f]) => '<img src="' + SRC + '" style="filter:' + f + '">').join("")
    + '</body></html>'
  );
  await p.waitForTimeout(1500);
  for (let i = 0; i < STEPS.length; i++) {
    const buf = await p.locator("img").nth(i).screenshot();
    fs.writeFileSync("/tmp/s_" + STEPS[i][0] + ".png", buf);
    console.log(STEPS[i][0].padEnd(20) + String(buf.length).padStart(6) + "B");
  }
  await b.close();
})();
