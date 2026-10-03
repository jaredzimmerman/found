// Which primitive in #halftone kills the output?
//
// Bisects the filter by injecting variants of the SVG and screenshotting the
// same figure for each. A blank card is ~600 bytes; a real one is ~48k. The
// variant that first goes blank is the culprit.
//
// The suspicion: `filter x="0%" y="0%" width="100%" height="100%"` sets the
// filter REGION to the element's box, but the seven `feTile` patterns are
// built from 3x3 <circle> tiles referenced by `feImage`. feImage rasterizes a
// referenced element at its OWN natural size (3x3 user units) and does not
// scale with the filter region. More importantly `feTile` tiles the tile
// across the filter region, then `feComposite operator="in"` intersects with
// it — if the tile geometry lands outside the image, the merge is empty.
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
await p.goto(`https://pinkpages.indigokarasu.com/?cb=${Date.now()}`, { waitUntil: "networkidle" });
await p.waitForSelector(".figure img");
await p.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 100));
  }
  window.scrollTo(0, 0);
});
await p.waitForFunction(() => [...document.querySelectorAll(".figure img")].every((i) => i.complete), { timeout: 30000 });
await p.waitForTimeout(800);

const fig = p.locator(".figure").first();
const size = async (label) => {
  const s = await fig.screenshot();
  return `${label}: ${s.length} bytes ${s.length < 5000 ? "  <-- BLANK" : "  ok"}`;
};

const out = [];
out.push(await size("as-shipped (#halftone)"));

// A: drop the final feComposite, so the merge result is the filter output
//    directly (dots over transparency, not knocked out of SourceGraphic).
out.push(
  await p.evaluate(() => {
    const f = document.querySelector("#halftone");
    const last = f.querySelector('feComposite[operator="in"][in2="SourceGraphic"]');
    last?.parentNode.removeChild(last);
    return "A: removed final knock-out feComposite";
  }),
);
await p.waitForTimeout(400);
out.push(await size("after A"));

// B: also remove the feColorMatrix luminanceToAlpha step, which converts the
//    photo to alpha — the threshold table then has nothing to threshold.
await p.evaluate(() => {
  document.querySelectorAll('#halftone feComponentTransfer').forEach((n) => n.remove());
});
await p.waitForTimeout(400);
out.push(await size("after B (componentTransfers removed)"));

// C: no filter at all — the control.
await p.addStyleTag({ content: `.figure img{filter:none !important}` });
await p.waitForTimeout(400);
out.push(await size("after C (filter:none control)"));

console.log(out.join("\n"));
await b.close();
