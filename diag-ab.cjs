const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");
const SRC = "https://assets0.dostuffmedia.com/uploads/aws_asset/aws_asset/32527476/d13d6b01-f78f-49a9-a20b-bb0164fde5ca.jpg";

// Two ways to put a photo on newsprint, measured head to head at the real card
// size, both resting and both on hover.
//
// A) SVG feImage/feTile. Chromium refuses to load an EXTERNAL resource from
//    inside an SVG filter applied to HTML content (the same-origin/taint rule
//    that makes `feImage` unreliable here), so the dot tables come back empty
//    and the chain collapses to a flat wash.
//
// B) Pure CSS: crush the photo to a hard B/W with grayscale+contrast, then lay
//    a repeating dot screen over it with mix-blend-mode:multiply. The screen
//    bites hardest in the midtones because that is where contrast() leaves
//    grey, which is exactly how a real halftone behaves. Hover fades the
//    screen out and drops the filter, returning the photo to colour.
const cell = (pitch, r) => "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + pitch + '" height="' + pitch + '">'
  + '<rect width="' + pitch + '" height="' + pitch + '" fill="white"/>'
  + '<circle cx="' + pitch / 2 + '" cy="' + pitch / 2 + '" r="' + r + '" fill="black"/></svg>');

const svgFilter =
  '<filter id="svgh" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">'
  + '<feImage href="' + cell(3, 1.2) + '" result="tS"/><feTile in="tS" result="sh"/>'
  + '<feImage href="' + cell(3, 0.6) + '" result="tH"/><feTile in="tH" result="hl"/>'
  + '<feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="lumA"/>'
  + '<feComponentTransfer in="lumA" result="inv"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>'
  + '<feComposite in="sh" in2="inv" operator="in" result="s1"/>'
  + '<feComposite in="hl" in2="lumA" operator="in" result="s2"/>'
  + '<feMerge><feMergeNode in="s1"/><feMergeNode in="s2"/></feMerge></filter>';

// The dot screen. `background-size` is the pitch; the radial gradient is one
// dot. rgba(0,0,0,a) with multiply over a white midtone darkens by `a`.
const screen = (pitch, dot, alpha) =>
  "radial-gradient(circle at 50% 50%, rgba(0,0,0," + alpha + ") 0 "
  + dot + "px, rgba(0,0,0,0) " + dot + "px) 0 0 / " + pitch + "px " + pitch + "px";

const CSS_A = "filter:url(#svgh);";
const CSS_B = "filter:grayscale(1) contrast(2.6) brightness(1.06);";
const CSS_B_H = "filter:none;";

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(
    '<!doctype html><html><head><style>'
    + 'body{margin:0;background:#fff}'
    + '.card{position:relative;width:355px;height:123px;overflow:hidden;margin:2px}'
    + '.card img{display:block;width:100%;height:100%;object-fit:cover;'
    + 'transition:filter .18s ease-out}'
    + '.card::after{content:"";position:absolute;inset:0;pointer-events:none;'
    + 'mix-blend-mode:multiply;opacity:1;transition:opacity .18s ease-out;'
    + 'background-image:' + screen(3, 1.1, 0.85) + '}'
    + '.a img{' + CSS_A + '}'
    + '.b img{' + CSS_B + '}'
    + '</style></head><body>'
    + '<svg width="0" height="0" aria-hidden="true"><defs>' + svgFilter + "</defs></svg>"
    + '<div class="card REF"><img src="' + SRC + '"></div>'
    + '<div class="card a"><img src="' + SRC + '"></div>'
    + '<div class="card b"><img src="' + SRC + '"></div>'
    + '<div class="card a H"><img src="' + SRC + '" style="' + CSS_B_H + '"></div>'
    + '<div class="card b H"><img src="' + SRC + '" style="' + CSS_B_H + '"></div>'
    + "</body></html>"
  );
  await p.waitForTimeout(3000);
  const names = ["REF", "A_svg", "B_css", "A_svg_hover", "B_css_hover"];
  for (let i = 0; i < names.length; i++) {
    const buf = await p.locator(".card").nth(i).screenshot();
    fs.writeFileSync("/tmp/ab_" + names[i] + ".png", buf);
  }
  console.log("captured " + names.join(", "));
  await b.close();
})();
