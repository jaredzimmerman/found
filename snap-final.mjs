// Re-take the full-page screenshot AFTER every image has settled, so the
// artifact reflects the page's real state rather than a mid-load one. The
// previous shots were taken too early and showed 59 pending images.
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const snap = async (name, viewport) => {
  const p = await b.newPage({ viewport });
  await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await p.evaluate(() => document.fonts.ready);
  // Wait for the LAST image to resolve, not the first. `networkidle` fires
  // before the masonry layout has run, so a card can be measured before its
  // image exists. Poll until every .figure img is complete.
  await p.waitForFunction(
    () => [...document.querySelectorAll(".figure img")].every(
      (i) => i.complete,
    ),
    { timeout: 30000 },
  );
  await p.waitForTimeout(600);
  const n = await p.evaluate(
    () => [...document.querySelectorAll(".figure img")].filter((i) => i.naturalWidth > 0).length,
  );
  const shots = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/shots";
  const path = `${shots}/${name}.png`;
  await p.screenshot({ path, fullPage: true });
  await p.close();
  return { name, imagesLoaded: n, path };
};

const out = {};
out.desktop = await snap("final-desktop-full", { width: 1440, height: 1000 });
out.phone = await snap("final-phone-full", { width: 390, height: 844 });
await b.close();
console.log(JSON.stringify(out, null, 2));