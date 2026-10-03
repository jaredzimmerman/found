// Is the halftone filter blanking the image, or is the image failing to load?
//
// Distinguishes the two by screenshotting the SAME element twice — once as the
// page renders it, once with the filter forced off — and comparing byte size.
// A blank region compresses to almost nothing; a real photo does not. This
// separates "not loaded" (image is empty either way) from "loaded but filtered
// to nothing" (image appears the moment the filter is dropped).
import { chromium } from "playwright-core";
import { statSync, writeFileSync } from "node:fs";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });

const failed = [];
p.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 90)}`));
const imgResults = [];
p.on("response", (r) => {
  if (r.request().resourceType() === "image") imgResults.push(`${r.status()} ${r.url().slice(0, 80)}`);
});

await p.goto(`https://pinkpages.indigokarasu.com/?cb=${Date.now()}`, { waitUntil: "networkidle" });
await p.waitForSelector(".figure img", { timeout: 20000 });

// `loading="lazy"` only fetches images near the viewport. Measuring straight
// after load therefore reports most of the page as 0x0 — which looks exactly
// like "the images are broken" and is not. Scroll the whole page in steps so
// every card is actually fetched, then wait for the count to settle.
await p.evaluate(async () => {
  const step = window.innerHeight;
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
});
await p.waitForFunction(
  () => {
    const imgs = [...document.querySelectorAll(".figure img")];
    return imgs.length > 0 && imgs.every((i) => i.complete);
  },
  { timeout: 30000 },
);
// Let the halftone rasterize before measuring.
await p.waitForTimeout(1500);

const out = {};

// Did the bytes actually arrive? This is the "not loading" half of the question.
out.imageRequests = imgResults.length;
out.non200 = imgResults.filter((s) => !s.startsWith("200")).slice(0, 5);
out.failed = failed.slice(0, 5);

// Did the browser decode them? complete && naturalWidth>0 means a real image.
out.decode = await p.evaluate(() => {
  const imgs = [...document.querySelectorAll(".figure img")];
  const withSrc = imgs.filter((i) => i.getAttribute("src"));
  return {
    imgsInDom: imgs.length,
    withSrc: withSrc.length,
    decodedOk: withSrc.filter((i) => i.complete && i.naturalWidth > 0).length,
    naturalSizes: [...new Set(withSrc.map((i) => `${i.naturalWidth}x${i.naturalHeight}`))].slice(0, 5),
    zeroNatural: withSrc.filter((i) => i.complete && i.naturalWidth === 0).length,
  };
});

// The same element, filtered vs unfiltered.
const fig = p.locator(".figure").first();
const withFilter = await fig.screenshot();
out.box = await fig.boundingBox();

await p.addStyleTag({
  content: `.figure img{filter:none !important;transform:none !important}`,
});
await p.waitForTimeout(600);
const noFilter = await fig.screenshot();

out.filteredPngBytes = withFilter.length;
out.unfilteredPngBytes = noFilter.length;
out.blankRatio = +(noFilter.length / Math.max(1, withFilter.length)).toFixed(2);
writeFileSync("/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/fig-filtered.png", withFilter);
writeFileSync("/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/fig-unfiltered.png", noFilter);

console.log(JSON.stringify(out, null, 2));
await b.close();
