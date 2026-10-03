// verify-title-venue.mjs returned a FALSE GREEN: `title`/`venue` were undefined
// (JSON drops undefined keys) and `allVenueBold` is `!el || weight>=600`, which
// passes vacuously when no `.venue` element exists. `price.count` was 0 too.
// So every selector in that script was invented. Print one real card's DOM.
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
      // The class list actually present in a rendered card, with counts.
      const counts = {};
      for (const el of document.querySelectorAll("#main *")) {
        for (const c of el.classList) counts[c] = (counts[c] || 0) + 1;
      }
      const top = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 45);

      // Outer HTML of the first card, trimmed.
      const card =
        document.querySelector(".row") ||
        document.querySelector("article") ||
        document.querySelector("[class*=card]");
      return {
        classCounts: Object.fromEntries(top),
        firstCardTag: card ? card.tagName + "." + card.className : null,
        firstCardHTML: card ? card.outerHTML.slice(0, 2600) : null,
      };
    }),
    null,
    2,
  ),
);
await b.close();
