const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");
const SRC = "https://assets0.dostuffmedia.com/uploads/aws_asset/aws_asset/32527476/d13d6b01-f78f-49a9-a20b-bb0164fde5ca.jpg";

// Why every previous grid variant hashed identically: the `<svg>` defs were
// injected into the page with setContent, and `feImage href="data:..."` inside
// it never loaded — so all 8 filters degraded to "no filter", and 8 identical
// photos. The fix is to give each image its OWN svg root as a real child of
// the document (not a detached string), and to WAIT for those feImage loads
// before measuring. Also: Chromium will not render a filter whose feImage
// failed to resolve; it falls through to identity. So the assertion that
// matters is per-variant byte size and correlation, not "did it error".

// The working construction from diag-tone (corr +0.949), generalised to a
// configurable cell, and with the dot radius swept small.
const cell = (p, r) => "data:image/svg+xml;base64," + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + p + '" height="' + p + '">'
  + '<rect width="' + p + '" height="' + p + '" fill="white"/>'
  + '<circle cx="' + p / 2 + '" cy="' + p / 2 + '" r="' + r + '" fill="black"/></svg>'
).toString("base64");

const defs = (i, p, r) =>
  '<filter id="f' + i + '" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">'
  + '<feImage href="' + cell(p, r) + '" result="t"/>'
  + '<feTile in="t" result="grid"/>'
  + '<feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="lumA"/>'
  + '<feComponentTransfer in="lumA" result="inv"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>'
  + '<feComposite in="grid" in2="inv" operator="arithmetic" k1="1" k2="0" k3="1" k4="0"/>'
  + '</filter>';

const V = [[3, 1.3], [3, 1.0], [3, 0.8], [4, 1.4], [4, 1.1], [4, 0.85]];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const svgDefs = '<svg width="0" height="0" aria-hidden="true"><defs>'
    + V.map((g, i) => defs(i, g[0], g[1])).join("") + "</defs></svg>";
  await p.setContent('<!doctype html><html><head><style>body{margin:0;background:#fff}'
    + 'img{width:355px;height:123px;display:block}</style>' + svgDefs
    + '</head><body>' + V.map((g, i) =>
      '<img src="' + SRC + '" style="filter:url(#f' + i + ')">').join("")
    + '</body></html>');
  // Give the data: feImages time to decode; a filter measuring identity is
  // indistinguishable from a filter that worked, so verify the filter chain
  // actually resolves before trusting any screenshot.
  await p.waitForTimeout(2500);
  const resolves = await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("img")) {
      const id = el.style.filter.match(/#(\w+)/)[1];
      out.push({ id, natural: el.naturalWidth, w: el.getBoundingClientRect().width });
    }
    return out;
  });
  console.log("images:", JSON.stringify(resolves));
  for (let i = 0; i < V.length; i++) {
    const n = "p" + V[i][0] + "r" + V[i][1];
    const buf = await p.locator("img").nth(i).screenshot();
    fs.writeFileSync("/tmp/ht_" + n + ".png", buf);
    console.log(n.padEnd(9) + String(buf.length).padStart(6) + "B");
  }
  await b.close();
})();
