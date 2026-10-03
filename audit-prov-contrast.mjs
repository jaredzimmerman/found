// The vision model is down, and "does it look right" is the wrong question anyway
// for a 10.5px word in --ink-3. What matters is measurable: does it clear WCAG
// AA against the paper it actually sits on, in all three themes?
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(800);

const themes = ["light", "dark", "pink"];
const out = {};
for (const t of themes) {
  await p.evaluate((th) => {
    document.documentElement.dataset.theme = th;
  }, t);
  await p.waitForTimeout(350);
  out[t] = await p.evaluate(() => {
    const prov = document.querySelector(".prov");
    const listing = document.querySelector(".prov.listing");
    const meta = prov.closest(".meta");
    // What is actually BEHIND the word: the paper of the card.
    const behind = getComputedStyle(meta || document.body).backgroundColor;
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const rowBg = getComputedStyle(prov.closest(".row")).backgroundColor;
    const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    return {
      provColor: getComputedStyle(prov).color,
      provFontSize: getComputedStyle(prov).fontSize,
      provWeight: getComputedStyle(prov).fontWeight,
      letterSpacing: getComputedStyle(prov).letterSpacing,
      bodyBg,
      rowBg,
      metaBg: behind,
      listingColor: listing ? getComputedStyle(listing).color : null,
      paperVar: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
      ink3Var: getComputedStyle(document.documentElement).getPropertyValue("--ink-3").trim(),
    };
  });
}
await b.close();
console.log(JSON.stringify(out, null, 2));
