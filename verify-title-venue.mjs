// Rewrite of verify-title-venue.mjs. Two defects in v1 made its green a lie:
//
//  1. `p.evaluate(readState)` serialized a function that CALLED closure helpers
//     (`vis`, `cs`). Playwright sends the function source only, so those names
//     are undefined in the page. Everything after the first call was bogus.
//  2. `allVenueBold: rows.every(r => !el || ...)` passes VACUOUSLY on an empty
//     list, and JSON drops `undefined` values — so `title`/`venue` keys simply
//     vanishing is what a total failure looks like, not a pass.
//
// Ground truth from dump-card-dom.mjs:
//   article.row > .time-col > .time
//   article.row > div > h3.row-title > a.title-e     (the only outbound link)
//   article.row > div > .meta > button.venue + span
//   article.row > div > .tags > button.tag
// => `.row > .venue` and `.row > .price` are DEAD selectors. Both elements are
//    grandchildren of .row. This is the real cause of the price never moving.
//
// Everything below is self-contained and FAILS LOUD: a missing target throws
// instead of returning a vacuous truth.
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const report = {};

for (const theme of ["light", "dark", "pink"]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await p.evaluate((t) => {
    localStorage.setItem("theme", t);
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  await p.evaluate(() => document.fonts.ready);
  await p.mouse.move(2, 2);
  await p.waitForTimeout(900);

  const rest = await p.evaluate(() => {
    const vis = (e) => !!e && e.offsetParent !== null;
    const rows = [...document.querySelectorAll("article.row")].filter(vis);
    if (rows.length < 3) throw new Error("expected >=3 visible rows, got " + rows.length);

    const titles = rows.map((r) => r.querySelector("a.title-e")).filter(vis);
    const venues = rows.map((r) => r.querySelector("button.venue")).filter(vis);
    if (!titles.length) throw new Error("no a.title-e found — selectors are wrong");
    if (!venues.length) throw new Error("no button.venue found — selectors are wrong");

    const und = (e) => getComputedStyle(e).textDecorationLine;
    return {
      rows: rows.length,
      titles: titles.length,
      venues: venues.length,
      // At rest: NOTHING underlined.
      underlinedAtRest: [...titles, ...venues].filter((e) => und(e).includes("underline")).length,
      // Venue: ALWAYS bold (>=600 of 1000).
      venuesNotBold: venues
        .filter((e) => Number(getComputedStyle(e).fontWeight) < 600)
        .map((e) => e.textContent.trim()),
      // Title weight, for reference.
      titleWeight: getComputedStyle(titles[0]).fontWeight,
      // The dead-selector proof, measured rather than asserted.
      rowsWithDirectVenue: rows.filter((r) => r.querySelector(":scope > button.venue")).length,
      rowsWithDirectPrice: rows.filter((r) => r.querySelector(":scope > .price")).length,
      // Where the price actually lives, and is it flush right?
      prices: rows.map((r) => r.querySelector(".price")).filter(vis).length,
      priceRightGap: rows
        .map((r) => r.querySelector(".price"))
        .filter(vis)
        .slice(0, 8)
        .map((pr) => {
          // The card, not the price's own parent — the price is inside the
          // unclassed body div, so measuring against its parent proves nothing.
          const card = pr.closest("article.row");
          return Math.round(card.getBoundingClientRect().right - pr.getBoundingClientRect().right);
        }),
    };
  });

  // Hover: the underline must APPEAR.
  const target = await p.evaluate(() => {
    const t = [...document.querySelectorAll("a.title-e")].find((e) => e.offsetParent !== null);
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await p.mouse.move(target.x, target.y);
  await p.waitForTimeout(400);
  const hovered = await p.evaluate(() => {
    const t = [...document.querySelectorAll("a.title-e")].find(
      (e) => e.offsetParent !== null && e.matches(":hover"),
    );
    return t ? getComputedStyle(t).textDecorationLine : "NO-HOVER-TARGET";
  });

  report[theme] = { ...rest, titleOnHover: hovered };
  await p.close();
}

await b.close();

// Verdict, computed here so it cannot be vacuous.
const fails = [];
for (const [theme, r] of Object.entries(report)) {
  if (r.underlinedAtRest !== 0) fails.push(`${theme}: ${r.underlinedAtRest} underlined at rest`);
  if (r.venuesNotBold.length) fails.push(`${theme}: venues not bold — ${r.venuesNotBold.join(", ")}`);
  if (!r.titleOnHover.includes("underline")) fails.push(`${theme}: title does not underline on hover (${r.titleOnHover})`);
}
console.log(JSON.stringify({ report, fails, pass: fails.length === 0 }, null, 2));
