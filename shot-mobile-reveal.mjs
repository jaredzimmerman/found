// Mobile screenshots of the reveal: the same card BEFORE it enters the viewport
// (screened) and AFTER (colour), so the effect can be seen as well as measured.
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";

const DIR = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/shots";
mkdirSync(DIR, { recursive: true });
const URL = "https://pinkpages.indigokarasu.com/?cb=" + Date.now();

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

for (const theme of ["light", "pink"]) {
  const ctx = await b.newContext({ ...devices["Pixel 7"] });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await p.evaluate((t) => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem("theme", t);
  }, theme);
  await p.reload({ waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);

  // Mark the probe, then scroll it into view and let the 500ms finish.
  const y = await p.evaluate(() => {
    const figs = [...document.querySelectorAll(".figure")];
    const f = figs[Math.min(4, figs.length - 1)];
    f.dataset.probe = "1";
    return f.getBoundingClientRect().top + scrollY;
  });
  await p.evaluate(() => scrollTo(0, 0));
  await p.waitForTimeout(300);
  await p.evaluate((yy) => scrollTo(0, yy - innerHeight * 0.35), y);
  await p.waitForTimeout(1100);
  await p.screenshot({ path: `${DIR}/reveal-${theme}.png` });
  console.log("wrote reveal-" + theme + ".png");
  await ctx.close();
}
await b.close();
