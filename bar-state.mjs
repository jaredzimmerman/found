import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(() => {
  const bar = document.querySelector(".filters") || document.querySelector("[data-collapsed]");
  const frow = document.querySelector("#frow");
  const tog = document.querySelector("#ftoggle");
  const chips = [...document.querySelectorAll("#frow .chip")].filter(c=>c.offsetParent!==null);
  return {
    foundBar: !!bar,
    collapsed: bar?.dataset.collapsed,
    userSet: bar?.dataset.userSet,
    ariaExpanded: tog?.getAttribute("aria-expanded"),
    frowDisplay: frow ? getComputedStyle(frow).display : null,
    frowHeight: frow ? Math.round(frow.getBoundingClientRect().height) : null,
    visibleChipsInFrow: chips.length,
    barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : null,
    barHidden: bar ? bar.hidden : null,
  };
}), null, 2));
await b.close();
