// Hover must still reveal the photo at full colour now that the resting state
// is a grayscale filter (it was `filter:none` on hover when the filter was the
// broken halftone, so the transition target is unchanged — but confirm, do
// not assume).
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto(`https://pinkpages.indigokarasu.com/?cb=${Date.now()}`, { waitUntil: "networkidle" });
await p.waitForSelector(".figure img");
await p.waitForTimeout(800);

const out = {};
await p.mouse.move(4, 4);
out.rest = await p.evaluate(
  () => getComputedStyle(document.querySelector(".figure img")).filter,
);

const fig = await p.locator(".figure").first().boundingBox();
await p.mouse.move(fig.x + fig.width / 2, fig.y + fig.height / 2);
await p.waitForTimeout(700); // let the 500ms transition finish
out.onHover = await p.evaluate(
  () => getComputedStyle(document.querySelector(".figure img")).filter,
);
out.transformOnHover = await p.evaluate(
  () => getComputedStyle(document.querySelector(".figure img")).transform,
);

// The dead SVG filter is still in the DOM. Confirm nothing references it, so
// it can be removed without changing rendering.
out.halftoneRefsInCss = await p.evaluate(() =>
  [...document.styleSheets]
    .flatMap((s) => {
      try { return [...s.cssRules].map((r) => r.cssText); } catch { return []; }
    })
    .filter((t) => t.includes("url(#halftone)")).length,
);
out.halftoneDefsPresent = await p.evaluate(() => !!document.querySelector("#halftone"));
out.halftoneIdRefs = await p.evaluate(
  () => document.querySelectorAll('[href*="halftone"], [fill*="halftone"]').length,
);

console.log(JSON.stringify(out, null, 2));
await b.close();
