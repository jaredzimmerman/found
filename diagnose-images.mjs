// Diagnose why 59 of 72 images fail to load their natural dimensions in the
// browser, when they serve 200 over a plain urllib fetch.
//
// The vision model reported solid grey boxes where photographs should be, and
// the probe measured naturalOk: 13 of 72. Those two findings agree with each
// other and disagree with a plain HTTP probe that gets 200s — so the failure
// is in the browser's context, not on the wire. This finds out which.
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });

const fails = [];
p.on("response", (r) => {
  if (/\.(jpe?g|png|webp)$/i.test(r.url())) {
    const s = r.status();
    if (s < 200 || s >= 400) fails.push({ url: r.url().slice(-48), status: s });
  }
});

await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(2000);

const probe = await p.evaluate(() => {
  const imgs = [...document.querySelectorAll(".figure img")];
  return {
    total: imgs.length,
    loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
    broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
    pending: imgs.filter((i) => !i.complete).length,
    // What is the .figure actually showing? background-color is what fills
    // the card when the image is absent.
    sampleBg: imgs[0] ? getComputedStyle(imgs[0].parentElement).backgroundColor : null,
    sampleSrc: imgs[0] ? imgs[0].getAttribute("src") : null,
    sampleNatural: imgs[0] ? imgs[0].naturalWidth : null,
    sampleComplete: imgs[0] ? imgs[0].complete : null,
    sampleRendered: imgs[0]
      ? {
          w: Math.round(imgs[0].getBoundingClientRect().width),
          h: Math.round(imgs[0].getBoundingClientRect().height),
          display: getComputedStyle(imgs[0]).display,
          visibility: getComputedStyle(imgs[0]).visibility,
        }
      : null,
  };
});

await b.close();
console.log(
  JSON.stringify(
    { httpFailures: fails.slice(0, 10), httpFailureCount: fails.length, probe },
    null,
    2,
  ),
);