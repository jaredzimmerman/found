// The reveal is a transient state. Confirm the RESTING state on a phone is still
// the screened halftone — i.e. this change did not turn the whole phone build
// into a colour page, which would break the newspaper aesthetic outright.
import { chromium, devices } from "playwright-core";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const ctx = await b.newContext({ ...devices["Pixel 7"] });
const p = await ctx.newPage();
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(),
  { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(900);
const out = await p.evaluate(() => {
  const figs = [...document.querySelectorAll(".figure")];
  const vis = figs.filter((f) => f.offsetParent !== null);
  const below = figs.filter((f) => !f.classList.contains("revealed"));
  return {
    total: vis.length,
    revealed: vis.filter((f) => f.classList.contains("revealed")).length,
    stillScreened: below.length,
    // Any revealed figure still showing a filter would mean the class landed but
    // the CSS did not apply.
    revealedButStillFiltered: vis.filter((f) =>
      f.classList.contains("revealed") &&
      getComputedStyle(f.querySelector("img")).filter !== "none").length,
    sampleBelowFold: below.slice(0, 3).map((f) => ({
      filter: getComputedStyle(f.querySelector("img")).filter,
      afterOpacity: +getComputedStyle(f, "::after").opacity,
    })),
  };
});
await b.close();
console.log(JSON.stringify(out, null, 2));
