// Probe: can a headless browser reach pages a plain fetch cannot?
//
// City Lights answers a plain fetch with a Cloudflare 307 and no body, so
// `fetch()` in the scraper never sees its calendar. A browser does. This
// confirms the approach and shows the DOM shape before a source is built on it.
import { chromium } from "playwright";

// Use the SYSTEM Chrome, not Playwright's bundled build. The ms-playwright
// cache on this host is build 1234 while the installed Playwright expects
// 1243, so a bundled launch fails with "Executable doesn't exist" — and
// downloading a ~150MB browser for one calendar page is the wrong trade.
// /usr/bin/google-chrome is already present and current.
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
const res = await page.goto("https://citylights.com/events/", {
  waitUntil: "domcontentloaded",
  timeout: 45000,
});
console.log(`  status ${res.status()}  ${page.url()}`);

// Everything runs INSIDE the page: querySelectorAll returns a NodeList, which
// has no .map, so the array methods below would throw. Array.from first.
const data = await page.evaluate(() => {
  const txt = document.body.innerText;
  const dates = [
    ...new Set(
      txt.match(/(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,?\s+(?:September|October)\s+\d{1,2},\s*2026/g) || []
    ),
  ];
  const links = Array.from(document.querySelectorAll('a[href*="/events/"]'))
    .map((a) => (a.getAttribute("href") || "").trim())
    .filter((h) => h && h !== "/events/" && h.split("/").filter(Boolean).length >= 2)
    .filter((v, i, a) => a.indexOf(v) === i);

  // Show the container around one in-window listing so the structure is visible.
  const h = Array.from(document.querySelectorAll("h1,h2,h3,h4")).find((el) =>
    /September 2[6-9],?\s*2026|September 30|October 1,?\s*2026/.test(el.textContent || "")
  );
  const card = h ? (h.closest("article,li,section,div")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300) : null;

  return { dates, links, card, around: txt.replace(/\s+/g, " ").slice(600, 1150) };
});

console.log(`  dated listings: ${data.dates.length}`);
data.dates.forEach((d) => console.log(`    ${d}`));
console.log(`  event links: ${data.links.length}`);
data.links.slice(0, 5).forEach((l) => console.log(`    ${l}`));
console.log(`\n  sample card:\n    ${data.card}`);
console.log(`\n  text around the first in-window event:\n    ${data.around}`);

await browser.close();
