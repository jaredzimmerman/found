// Screenshot the filter bar with the search field FOCUSED, so the fix can be
// seen rather than only measured, and so the next run has a before/after pair.
// A focused and an unfocused search field used to be pixel-identical, which is
// exactly why this needed a script rather than a look.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const DIR = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/shots";
mkdirSync(DIR, { recursive: true });

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

for (const [name, width, theme] of [
  ["focus-ring-light-desktop", 1440, "light"],
  ["focus-ring-dark-desktop", 1440, "dark"],
  ["focus-ring-light-mobile", 390, "light"],
]) {
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  const p = await ctx.newPage();
  await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  if (theme !== "light") {
    await p.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      localStorage.setItem("theme", t);
    }, theme);
    await p.waitForTimeout(400);
  }
  await p.evaluate(() => document.fonts.ready);
  await p.mouse.move(2, 2);
  await p.click('input[type=search]');
  await p.waitForTimeout(400);
  const f = `${DIR}/${name}.png`;
  await p.screenshot({ path: f });
  console.log("wrote", f);
  await ctx.close();
}
await b.close();
