// I claimed last turn that `.row>.price` was a dead selector and that `.price`
// lives in the unclassed body div. The measurement I had ALREADY run contradicts
// that: rowsWithDirectPrice was 134, not 0. I inferred it from a single card's
// outerHTML — and that card happened to be a free event with no price badge at
// all, so the dump proved nothing about where `.price` lives.
//
// Get ground truth: the parent chain of `.price` and `.venue` across many rows,
// plus which CSS selectors involving them actually match.
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
await p.mouse.move(2, 2);
await p.waitForTimeout(900);

console.log(
  JSON.stringify(
    await p.evaluate(() => {
      const vis = (e) => !!e && e.offsetParent !== null;
      const rows = [...document.querySelectorAll("article.row")].filter(vis);

      const path = (el) => {
        const out = [];
        let n = el;
        while (n && n.tagName !== "BODY") {
          out.push(n.tagName.toLowerCase() + (n.className ? "." + n.className : ""));
          n = n.parentElement;
        }
        return out.join(" < ");
      };

      const prices = rows.map((r) => r.querySelector(".price")).filter(vis);
      const venues = rows.map((r) => r.querySelector(".venue")).filter(vis);

      // Do the "dead" selectors actually match, per row?
      const matchCounts = {
        "row > .price": rows.filter((r) => r.querySelector(":scope > .price")).length,
        "row > .venue": rows.filter((r) => r.querySelector(":scope > .venue")).length,
        "row > .meta > .venue": rows.filter((r) => r.querySelector(":scope > .meta > .venue")).length,
        "row > *:not(.time-col):not(.price)": rows.filter((r) => r.querySelector(":scope > *:not(.time-col):not(.price)")).length,
        "row > .time-col": rows.filter((r) => r.querySelector(":scope > .time-col")).length,
      };

      // A row WITH a price, printed in full, to see the true structure.
      const withPrice = rows.find((r) => r.querySelector(":scope > .price"));
      const withNoPrice = rows.find((r) => !r.querySelector(".price"));

      return {
        rows: rows.length,
        pricesFound: prices.length,
        venuesFound: venues.length,
        matchCounts,
        pricePath: prices[0] ? path(prices[0]) : null,
        venuePath: venues[0] ? path(venues[0]) : null,
        distinctPricePaths: [...new Set(prices.slice(0, 40).map(path))],
        rowWithPriceHTML: withPrice ? withPrice.outerHTML.slice(0, 1100) : null,
        rowWithoutPriceHTML: withNoPrice ? withNoPrice.outerHTML.slice(0, 700) : null,
      };
    }),
    null,
    2,
  ),
);
await b.close();
