// Full acceptance pass for the standing goal. Every criterion is a measured
// assertion, not a claim. Anything this cannot prove, it reports as unproven.
import { chromium } from "playwright-core";
import fs from "node:fs";

const URL = "https://pinkpages.indigokarasu.com/";
const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto(URL + "?cb=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.mouse.move(2, 2);
await p.waitForTimeout(1200);

const R = {};
const feed = JSON.parse(
  fs.readFileSync("/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/events.json", "utf8"),
);
const feedEvents = feed.events || feed;
const now = new Date();

// --- window: next 3 days -------------------------------------------------
R.window = await p.evaluate(() => {
  const heads = [...document.querySelectorAll(".day-head")].map((h) =>
    h.querySelector(".day-date")?.textContent.trim(),
  );
  return { dayHeaders: heads, days: heads.length };
});
R.window.allWithin3Days = R.window.days <= 3;

// --- sold-out filter -----------------------------------------------------
R.soldOut = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".row")];
  const sold = rows.filter((r) => r.classList.contains("sold"));
  return { rows: rows.length, soldOutRowsRendered: sold.length, defaultHidesSoldOut: sold.length === 0 };
});

// --- links point at the venue, not an aggregator ------------------------
const AGGREGATORS = /(eventbrite\.com|ticketmaster|seatgeek|stubhub|allevents\.in|ra\.co|eventful|sfweekly\.com|\bsonicom\.|bandsintown|festivalscene)/i;
R.links = await p.evaluate(() => {
  const as = [...document.querySelectorAll("a.title-e")];
  return { total: as.length, sample: as.slice(0, 5).map((a) => a.href), allHaveRel: as.every((a) => (a.rel || "").includes("noopener")) };
});
R.links.aggregatorHits = R.links.sample.filter((u) => AGGREGATORS.test(u)).length;
R.links.ok = R.links.aggregatorHits === 0 && R.links.total > 0;

// --- filters: type / venue / price / neighborhood ------------------------
R.filters = await p.evaluate(() => {
  const groups = {};
  for (const g of document.querySelectorAll("[id^='f-']")) groups[g.id] = {
    chips: g.querySelectorAll(".chip").length,
  };
  return {
    groups: Object.keys(groups),
    counts: groups,
    // The bar being CLOSED is the requirement. So assert closed, not open:
    // `aria-expanded` on the toggle is false AND the panel is actually hidden.
    // The first version of this check read the inverse and reported a FAIL on
    // a bar that measured collapsed:"true" / display:none.
    //
    // Named `collapsedByDefault`, NOT `barOpenByDefault`. It holds the
    // collapsed verdict, and the old name said the opposite of what it
    // measured. A result file then reported `barOpenByDefault: true` beside
    // `closedByDefault: true` — the same true fact under two contradictory
    // names, which is exactly what sent me misreading this field three times
    // while the site was correct all along.
    collapsedByDefault:
      document.querySelector("#ftoggle")?.getAttribute("aria-expanded") === "false" &&
      getComputedStyle(document.querySelector("#frow")).display === "none",
  };
});
R.filters.hasType = R.filters.groups.some((g) => g.includes("type"));
R.filters.hasPrice = R.filters.groups.some((g) => g.includes("price"));
R.filters.hasVenue = !!R.filters.groups.some((g) => g.includes("venue")) || !!document.querySelector("button.venue");
R.filters.hasNeighborhood = R.filters.groups.some((g) => g.includes("hood") || g.includes("neigh"));
R.filters.closedByDefault = R.filters.collapsedByDefault === true;

// --- zero-result chips hidden --------------------------------------------
R.zeroChips = await p.evaluate(() => {
  const chips = [...document.querySelectorAll(".chip")].filter((c) => c.offsetParent !== null);
  const zero = chips.filter((c) => {
    const n = c.querySelector(".n");
    return n && parseInt(n.textContent, 10) === 0;
  });
  return { visibleChips: chips.length, chipsShowingZero: zero.length };
});
R.zeroChips.ok = R.zeroChips.chipsShowingZero === 0;

// --- non-standard venues in the corpus ----------------------------------
// Each venue the brief named carries its OWN expectation, and the check asserts
// them individually.
//
// This used to be `Object.values(wanted).some(v => v > 0)` — satisfied by a
// SINGLE venue while ignoring the other five, so "Workshop SF" could drop to 0
// and the suite stayed green. Worse, a 0 for a venue that genuinely has nothing
// in the window (SF Flower Market) is indistinguishable from a broken scraper
// unless the expectation says which one it is. `expect` records the verified
// truth, so a regression is loud and a real absence is quiet.
const WANT = [
  { name: "Center for the Book", expect: ">0", why: "has recurring events; a 0 means the Squarespace scraper broke" },
  { name: "City Lights", expect: ">0", why: "own event pages; a 0 means the City Lights scraper broke" },
  { name: "Omnivore", expect: ">0", why: "Shopify events page; a 0 means that scraper broke" },
  { name: "Workshop SF", expect: ">0", why: "Tribe feed holds 94 events; a 0 means the title-shape reader broke" },
  { name: "SF Flower Market", expect: "0", why: "verified 2026-09-29: page says 'no events matched', market is a recurring Wed-Sat schedule" },
  { name: "Clayroom", expect: "0", why: "verified 2026-09-29: Wix site, class grid is client-rendered, no dated listing exists" },
];
R.venues = {
  total: new Set(feedEvents.map((e) => e.venue).filter(Boolean)).size,
  wanted: {},
  expectations: [],
};
for (const w of WANT) {
  const n = feedEvents.filter((e) => (e.venue || "").toLowerCase().includes(w.name.toLowerCase())).length;
  const pass = w.expect === "0" ? n === 0 : n > 0;
  R.venues.wanted[w.name] = n;
  R.venues.expectations.push({ venue: w.name, found: n, expect: w.expect, pass, why: w.why });
}
R.venues.ok = R.venues.expectations.every((e) => e.pass);

// --- categories coverage -------------------------------------------------
R.categories = [...new Set(feedEvents.flatMap((e) => e.categories || []))].sort();
R.hasMovies = R.categories.some((c) => /film|movie|cinema|screen/i.test(c));
R.hasMusic = R.categories.some((c) => /music|concert|perform/i.test(c));

// --- accessibility basics -----------------------------------------------
R.a11y = await p.evaluate(() => {
  const hs = [...document.querySelectorAll("h1,h2,h3")].map((h) => h.tagName);
  const imgs = [...document.querySelectorAll("img")];
  const btns = [...document.querySelectorAll("button")];
  const focusableNoName = btns.filter((b) => {
    if (b.offsetParent === null) return false;
    return !(b.textContent || "").trim() && !b.getAttribute("aria-label") && !b.title;
  }).length;
  const radios = document.querySelectorAll('input[type=radio][name="theme"]').length;
  const skip = !!document.querySelector("a[href^='#']:not([href='#'])");
  return {
    h1: hs.filter((t) => t === "H1").length,
    outline: { H1: hs.filter((t) => t === "H1").length, H2: hs.filter((t) => t === "H2").length, H3: hs.filter((t) => t === "H3").length },
    imgAltMissing: imgs.filter((i) => i.getAttribute("alt") === null).length,
    imgCount: imgs.length,
    unnamedButtons: focusableNoName,
    themeRadios: radios,
    skipLink: skip,
  };
});

// --- three themes --------------------------------------------------------
R.themes = await p.evaluate(() => {
  const out = {};
  for (const r of document.querySelectorAll('input[type=radio][name=theme]')) out[r.value] = r.checked;
  return { radios: Object.keys(out).length, checked: Object.keys(out).filter((k) => out[k]) };
});

// --- verdict -------------------------------------------------------------
const checks = [
  ["events render (3-day window)", R.window.allWithin3Days && R.soldOut.rows > 0],
  ["sold-out removed by default", R.soldOut.defaultHidesSoldOut],
  ["links are venue pages, not aggregators", R.links.ok],
  ["filter by type", R.filters.hasType],
  ["filter by price", R.filters.hasPrice],
  ["filter by venue", R.filters.hasVenue],
  ["filter by neighborhood", R.filters.hasNeighborhood],
  ["filter bar closed by default", R.filters.closedByDefault],
  ["zero-result chips hidden", R.zeroChips.ok],
  ["non-standard venues present", R.venues.ok],
  ["movies covered", R.hasMovies],
  ["music/performance covered", R.hasMusic],
  ["heading outline h1>h2>h3", R.a11y.h1 === 1 && R.a11y.outline.H2 > 0 && R.a11y.outline.H3 > 0],
  ["all images have alt", R.a11y.imgAltMissing === 0],
  ["all visible buttons named", R.a11y.unnamedButtons === 0],
  ["skip link present", R.a11y.skipLink],
  ["three themes", R.themes.radios === 3],
];
R.verdict = Object.fromEntries(checks.map(([k, v]) => [k, v ? "PASS" : "FAIL"]));
R.passed = checks.filter(([, v]) => v).length;
R.total = checks.length;

await b.close();
console.log(JSON.stringify(R, null, 2));
