// Why is .tag still under 24px? Ask the computed style and the cascade
// directly instead of reasoning about source order.
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
await p.waitForTimeout(1000);

const r = await p.evaluate(() => {
  const v = document.querySelector(".venue");
  const t = document.querySelector(".tag");
  const dump = (e) => {
    const c = getComputedStyle(e);
    const bb = e.getBoundingClientRect();
    return {
      cls: e.className,
      box: { w: Math.round(bb.width), h: Math.round(bb.height) },
      padding: c.padding,
      margin: c.margin,
      lineHeight: c.lineHeight,
      fontSize: c.fontSize,
      display: c.display,
      boxSizing: c.boxSizing,
      borderWidth: c.borderWidth,
      verticalAlign: c.verticalAlign,
      flex: c.flex,
    };
  };
  // Every rule that mentions padding or margin and touches tag/venue.
  const hits = [];
  for (const sheet of document.styleSheets) {
    let rs;
    try {
      rs = sheet.cssRules;
    } catch {
      continue;
    }
    const walk = (rule, ctx) => {
      if (rule.cssRules) {
        for (const i of rule.cssRules)
          walk(i, ctx + " " + (rule.conditionText || rule.media?.mediaText || ""));
      } else if (
        rule.selectorText &&
        /padding|margin/.test(rule.style.cssText) &&
        /tag|venue/.test(rule.selectorText)
      ) {
        hits.push({ sel: rule.selectorText, ctx: ctx.trim(), css: rule.style.cssText.slice(0, 160) });
      }
    };
    for (const r of rs) walk(r, "");
  }
  // Are there MULTIPLE tag elements with different heights? Report the spread.
  const tags = [...document.querySelectorAll(".tag")].map((e) => Math.round(e.getBoundingClientRect().height));
  const venues = [...document.querySelectorAll(".venue")].map((e) => Math.round(e.getBoundingClientRect().height));
  const tally = (arr) => arr.reduce((m, n) => ((m[n] = (m[n] || 0) + 1), m), {});
  return { venue: dump(v), tag: dump(t), rules: hits, tagHeights: tally(tags), venueHeights: tally(venues) };
});

console.log(JSON.stringify(r, null, 2));
await b.close();
