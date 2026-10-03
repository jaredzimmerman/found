const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");

// No more labs. Measure the SHIPPED page, because that is the thing under
// question. Four questions, each answered by the live document:
//   1. does the halftone SVG exist in the body?
//   2. do the card images resolve to url(#halftone)?
//   3. do they RENDER differently from the unfiltered photo?
//   4. does hover restore full colour?
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
  await p.waitForSelector(".figure img", { timeout: 25000 });
  await p.waitForTimeout(3000);

  const st = await p.evaluate(() => {
    const img = document.querySelector(".figure img");
    const cs = getComputedStyle(img);
    return {
      svgInBody: !!document.querySelector("svg#halftone, filter#halftone, [id=halftone]"),
      svgCount: document.querySelectorAll("svg").length,
      feTile: document.querySelectorAll("feTile").length,
      circle: document.querySelectorAll("circle").length,
      filter: cs.filter,
      naturalW: img.naturalWidth,
      shownW: Math.round(img.getBoundingClientRect().width),
      imgs: document.querySelectorAll(".figure img").length,
      complete: [...document.querySelectorAll(".figure img")].filter(i => i.complete && i.naturalWidth > 0).length,
    };
  });
  console.log("STATE", JSON.stringify(st, null, 1));

  const first = p.locator(".figure img").first();
  await first.screenshot({ path: "/tmp/live_rest.png" });

  // Hover the card and re-shoot: the same pixels, with the filter lifted.
  await p.locator(".figure").first().hover();
  await p.waitForTimeout(900);
  await first.screenshot({ path: "/tmp/live_hover.png" });
  const after = await p.evaluate(() => getComputedStyle(
    document.querySelector(".figure img")).filter);
  console.log("filter on hover:", after);
  await b.close();

  // Are the two shots actually different?
  const { execSync } = require("child_process");
  console.log(execSync("md5sum /tmp/live_rest.png /tmp/live_hover.png").toString());
})();
