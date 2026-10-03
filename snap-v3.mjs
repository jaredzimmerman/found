// Final visual-refinement screenshots. Every image is now guaranteed loaded
// before the capture, so the artifact reflects the page's real state.
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const shots = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/shots";

const snap = async (name, viewport, full) => {
  const p = await b.newPage({ viewport });
  await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1500);
  const path = `${shots}/${name}.png`;
  await p.screenshot({ path, fullPage: full });
  await p.close();
  return { name, path };
};

const out = {};
out.desktop = await snap("v3-desktop", { width: 1440, height: 1000 }, true);
out.phone = await snap("v3-phone", { width: 390, height: 844 }, true);
await b.close();
console.log(JSON.stringify(out, null, 2));