// Screenshots, not measurements. The user is right that I have been verifying
// computed values instead of looking at the page. This takes real captures
// and then I read them with vision_analyze.
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const out = {};

async function shot(viewport, name, full) {
  const page = await b.newPage({ viewport });
  await page.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(500);
  const path = `/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/${name}.png`;
  await page.screenshot({ path, fullPage: full });
  return path;
}

out.desktop = await shot({ width: 1440, height: 1000 }, "shot-desktop", false);
out.desktopFull = await shot({ width: 1440, height: 1000 }, "shot-desktop-full", true);
out.phone = await shot({ width: 390, height: 844 }, "shot-phone", false);
out.phoneFull = await shot({ width: 390, height: 844 }, "shot-phone-full", true);

// Also capture the filter bar specifically on each viewport
const desk = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await desk.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
await desk.mouse.move(2, 2);
await desk.waitForTimeout(500);
out.filterBarDesktop = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/shot-filter-desktop.png";
await desk.screenshot({ path: out.filterBarDesktop, clip: { x: 0, y: 0, width: 1440, height: 220 } });

const phone = await b.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
await phone.mouse.move(2, 2);
await phone.waitForTimeout(500);
out.filterBarPhone = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/shot-filter-phone.png";
await phone.screenshot({ path: out.filterBarPhone, clip: { x: 0, y: 0, width: 390, height: 300 } });

await b.close();
console.log(JSON.stringify(out, null, 2));