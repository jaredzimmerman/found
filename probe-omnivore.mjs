// Read Omnivore Books' event dates.
//
// Omnivore's collection page lists a dozen author events but carries NO dates —
// they live on each event's own page. So this walks the event pages in one
// browser session and reports which fall inside the 3-day window.
//
// Note the shape difference from City Lights: Shopify "products", not a
// WordPress calendar, and several listings are marked *OFF-SITE* (the event
// happens elsewhere — at Reem's, for instance). An off-site listing is still a
// real SF event, but the venue is not the bookshop, so it must not be filed
// under Omnivore's address.
import { chromium } from "playwright";

const DAYS = process.argv[2] ? process.argv[2].split(",") : ["2026-09-29", "2026-09-30", "2026-10-01"];
const INDEX = "https://omnivorebooks.myshopify.com/collections/upcoming-events";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.goto(INDEX, { waitUntil: "domcontentloaded", timeout: 45000 });

const events = await page.evaluate(() =>
  Array.from(document.querySelectorAll('a[href*="/products/"]'))
    .map((a) => ({ title: a.textContent.replace(/\s+/g, " ").trim(), href: a.href }))
    .filter((x) => x.title.length > 8)
    .filter((v, i, arr) => arr.findIndex((z) => z.href === v.href) === i)
);

console.log(`  event pages found: ${events.length}`);

const inWindow = [];
for (const ev of events) {
  try {
    await page.goto(ev.href, { waitUntil: "domcontentloaded", timeout: 30000 });
    const d = await page.evaluate(() => {
      const t = document.body.innerText.replace(/\s+/g, " ");
      // The date line is ALL CAPS with an "AT" separator and NO year:
      //   "TUESDAY, SEPTEMBER 29 AT 6:30 PM"
      // A mixed-case, year-bearing regex matches nothing here and returns
      // "no date" for every event — which reads as "no events in window"
      // rather than "my pattern is wrong".
      const m = t.match(
        /\b((?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),\s*(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+\d{1,2})\s+AT\s+(\d{1,2}(?::\d{2})?\s*[AP]M)/i
      );
      const offSite = /off-?site/i.test(document.body.innerText);
      const venue = (t.match(/(Reem'?s[^,.]*|Ferry Building[^,.]*|at [\w' ]+ in San Francisco[^,.]*)/i) || [])[1] || null;
      return { date: m ? m[1] : null, time: m ? m[2] : null, offSite, venue, len: t.length };
    });
    // The page carries NO year, so it is inferred from the window: a month/day
    // that falls in the window's year is in the window. Anything else is out.
    const dm = d.date && d.date.match(/([A-Za-z]+),?\s*(\d{1,2})$/);
    const MON = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
    let iso = null;
    if (dm) {
      const mm = MON[dm[1].trim().toLowerCase()];
      if (mm != null) {
        const year = DAYS[0].slice(0, 4);
        iso = `${year}-${String(mm + 1).padStart(2, "0")}-${String(dm[2]).padStart(2, "0")}`;
      }
    }
    const hit = iso && DAYS.includes(iso);
    if (hit) inWindow.push({ ...ev, ...d, iso });
    console.log(`  ${hit ? "IN-WINDOW " : "          "}${String(iso || (d.date || "no date")).padEnd(12)} ${ev.title.slice(0, 58)}${d.offSite ? "  [OFF-SITE]" : ""}`);
  } catch (e) {
    console.log(`           FAILED  ${ev.title.slice(0, 50)} — ${String(e.message).split("\n")[0]}`);
  }
}

console.log(`\n  in window (${DAYS.join(", ")}): ${inWindow.length}`);
for (const e of inWindow) console.log(`    ${e.iso}  ${e.title.slice(0, 64)}\n      ${e.href}`);
await browser.close();
