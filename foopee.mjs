// ---------------------------------------------------------------------------
// The List (foopee.com) — Steve Koepke's Bay Area concert guide.
//
// Measured 2026-10-03 against by-date.0.html (week of Sep 28 - Oct 4). The
// source is entirely static HTML — no JS, no interstitial, no challenge — so it
// parses with a plain fetch on any host. It is also the cheapest source in the
// project to run on DreamHost, where a browser is not available at all.
//
// Structure is 1990s markup, unusual enough to be worth stating: no <div>, no
// <span>, no <table>. A date anchor opens a <UL> and each listing is one <LI>
// running to end of line:
//
//   <A NAME="oct_02"><B>Fri Oct 2</B></A><UL>
//   <LI><B><A HREF="by-club.0.html#Chapel__S_F_">Chapel, S.F.</A></B>
//       <A HREF="by-band.2.html#Rum_Jungle">Rum Jungle</A>, <A ...>Trestles</A>
//       21+ $35.05 8pm/9pm
//
// Read as: <venue>, <city> <artists> [<age>] [$price] [<times>] [<flags>].
// The venue link points at a venue INDEX anchored on the venue name, not at an
// event page, so there is no per-show URL. The listing links out to the by-date
// page it was actually read from rather than to a band index — a band anchor is
// a cross-listing dump and a worse destination than the dated listing.
//
// SCOPING — the reason this module is careful. The page's own subtitle calls it
// a "(San Francisco) Bay Area concert guide", and it is exactly that: of 63
// distinct venues in a normal week, only 26 are in San Francisco. The rest are
// Oakland, Berkeley, Santa Cruz, Petaluma, San Jose, Napa, and a long tail of
// Marin and Sonoma towns. This feed is San Francisco-only, so this filter is not
// an optimisation — it is the difference between a correct feed and one that
// quietly reports 60% wrong geography. Only a literal "S.F." passes. A city
// denylist would be worse: it silently admits anything it has not seen, which for
// a Bay Area guide means admitting a new suburb every week.
//
// Three traps, all of which yield a plausible-looking wrong answer:
//
//   1. Venue labels embed street addresses containing commas:
//        "Delta Sports Bar, 6210 Bethel Island Road, Bethel Island"
//        "Waterhawk Lake Club, 5000 Roberts Lake Rd., Rohnert Park"
//      so the city is the LAST comma-token, never the second. Splitting on the
//      first comma reads the street number as the city and files a Fremont show
//      as being in "43737 Boscell Road".
//
//   2. "Castro," has NO city in its venue label — the "S.F." is displaced into the
//      trailing metadata ("Michelle Branch a/a S.F. 7pm/8pm"). Reading only the
//      venue anchor drops the Castro Theatre; taking the first city-shaped token
//      anywhere in the line starts inventing cities.
//
//   3. Times are "8pm", not "8:00pm". The shared parseTimeToMinutes() requires
//      hh:mm and returns -1 for a bare hour, so reusing it here silently drops
//      every listing that prints a whole-hour time — which is most of them.
//      toMinutes() below handles both forms.
// ---------------------------------------------------------------------------

import { tSafe, decodeEntities, cleanTitle, register, categorize, clock } from "./fetch.mjs";
import { timeRangeLabel } from "./shared.mjs";

const INDEX = "http://www.foopee.com/punk/the-list/";
// The weekly pages are siblings of the INDEX, not of /punk/. Probed: the index
// links are relative, so by-date.0.html joined against /punk/ is a 404 and
// against /punk/the-list/ is the listing. Getting this wrong reads as "the
// source is dead" rather than as a bad join.
const WEEK = "http://www.foopee.com/punk/the-list/by-date.";

// One listing: the venue anchor, then everything up to end of line. The inner
// <UL> is never closed and there is no </LI>, so the newline is the only
// reliable terminator — every listing in the file is exactly one line.
const LISTING = /<LI><B><A HREF="by-club[^"]*">([\s\S]*?)<\/A><\/B>([\s\S]*?)(?=\n)/g;

// Date anchor: <A NAME="oct_02"><B>Fri Oct 2</B></A>. The MONTH is in the
// anchor's own name ("oct_02"), so it is read from there rather than inferred
// from the page's <H2> week header. Inferring it was wrong: a week headed
// "Sep 28 - Oct 4" contains days 1..4 of October under a September header, so
// every listing after the rollover was filed a month early — an Oct 4 show
// dated Sep 2, which then fell outside the build window and vanished.
const DAY_ANCHOR = /<A NAME="([a-z]{3})_(\d{1,2})"><B>\w{3} \w{3} \d+<\/B><\/A>/i;

// A printed time: "8pm", "7:30pm", "noon", "5pm", optionally a "/9:30pm" second.
const TIME = /\b(\d{1,2}:\d{2}\s*[ap]m|\d{1,2}\s*[ap]m|noon|midnight)\b(?:\s*\/\s*(\d{1,2}:\d{2}\s*[ap]m|\d{1,2}\s*[ap]m|noon|midnight))?/gi;

// Prices, including the "free"/"donation" forms that carry no dollar sign.
const PRICE = /\$[\d,.]+(?:\s*-\s*\$?[\d,.]+)?\+?|\bdonations?\b|\bfree\b/i;

// Accepts both "8pm" and "7:30pm". Returns -1 when unparseable, matching the
// shared convention, so a caller testing `< 0` catches it either way.
function toMinutes(t) {
  if (!t) return -1;
  const s = String(t).trim().toLowerCase();
  if (/^noon$/.test(s)) return 12 * 60;
  if (/^midnight$/.test(s)) return 0;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])m$/);
  if (!m) return -1;
  let hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  if (mm > 59) return -1;
  if (hh > 23) return -1;
  if (m[3] === "p" && hh < 12) hh += 12;
  if (m[3] === "a" && hh === 12) hh = 0;
  return hh * 60 + mm;
}

// The venue's city is the LAST comma-token, because labels embed comma-bearing
// street addresses. "Castro," is special-cased: it carries no city at all.
function cityOf(venueLabel) {
  const v = String(venueLabel || "").trim();
  if (/^Castro,?$/i.test(v)) return "S.F.";
  const parts = v.split(",");
  return (parts[parts.length - 1] || "").trim();
}

// Positive allowlist on the literal abbreviation. An unrecognised venue is
// EXCLUDED, and the caller prints what it excluded, so a genuine SF venue lost
// to this filter shows up as a named gap instead of a silent one.
function isSF(city) {
  return city === "S.F.";
}

// Splits the raw page into dated listing records. Pure and exported so the test
// can run it against a fixture without a network fetch.
function parseListings(html, days) {
  const out = [];

  // Walk the page in document order, tracking the current date header, so each
  // listing is attributed to the day it sits under.
  const token = /(<A NAME="([a-z]{3})_(\d{1,2})"><B>\w{3} \w{3} \d+<\/B><\/A>)|(<LI><B><A HREF="by-club[^"]*">([\s\S]*?)<\/A><\/B>([\s\S]*?)(?=\n))/gi;
  let cur = null;
  let m;
  while ((m = token.exec(html)) !== null) {
    if (m[1]) {
      cur = `${new Date().getFullYear()}-${String(monthIndex(m[2]) + 1).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
      continue;
    }
    if (!cur) continue;

    const venueLabel = decodeEntities(m[5] || "").trim();
    const rest = m[6] || "";
    if (!venueLabel) continue;

    const plain = rest.replace(/<[^>]+>/g, " ");
    const artists = [];
    for (const a of rest.matchAll(/<A HREF="by-band[^"]*">([^<]+)<\/A>/g)) {
      const n = decodeEntities(a[1]).trim();
      if (n) artists.push(n);
    }
    const times = [];
    for (const t of plain.matchAll(new RegExp(TIME.source, "gi"))) {
      if (t[1]) times.push(t[1]);
      if (t[2]) times.push(t[2]);
    }
    const pm = plain.match(PRICE);

    out.push({
      date: cur,
      venue: venueLabel.replace(/,\s*$/, "").trim(),
      city: cityOf(venueLabel),
      artists: artists.join(", ").replace(/,\s*$/, ""),
      times,
      price: pm ? pm[0].trim() : null,
      page: WEEK + "0.html",
    });
  }

  if (days && days.length) return out.filter((r) => days.includes(r.date));
  return out;
}

function monthIndex(name) {
  const m = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const i = m[String(name).slice(0, 3).toLowerCase()];
  return i === undefined ? new Date().getMonth() : i;
}

async function foopee(days) {
  const html = (await tSafe(WEEK + "0.html")) || "";
  if (!html) return console.log("  foopee: weekly page unavailable — skipped");

  const listings = parseListings(html, days);
  if (!listings.length) {
    // 0 parsed is never "nothing on". It means the shape changed — and from the
    // outside those two look identical while meaning opposite things: an empty
    // feed versus a silently dead source.
    return console.log("  foopee: 0 listings parsed in window — page shape may have changed");
  }

  let added = 0, outOfCity = 0, noTime = 0;
  const excluded = new Map();
  const noTimeNames = [];

  for (const L of listings) {
    if (!isSF(L.city)) {
      outOfCity++;
      excluded.set(L.venue, (excluded.get(L.venue) || 0) + 1);
      continue;
    }
    const row = buildRow(L);
    if (!row) { noTime++; noTimeNames.push(`${L.venue}: ${L.artists}`); continue; }
    if (register(row)) added++;
  }

  console.log(`  foopee: ${added} SF events (${outOfCity} out-of-city excluded, ${noTime} skipped for no time, ${listings.length} in window)`);
  if (outOfCity && excluded.size) {
    const top = [...excluded.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`    excluded: ${top.map(([v, n]) => `${v} (${n})`).join(", ")}`);
  }
  // Printed so a venue that lost every one of its shows to the time parser is
  // visible in the build log rather than being a hole in the feed.
  if (noTimeNames.length) {
    console.log(`    no parseable time: ${noTimeNames.slice(0, 5).join(" | ")}`);
  }
}

function buildRow(L) {
  const title = cleanTitle(L.artists);
  if (!title) return null;

  const start = toMinutes(L.times[0]);
  // A -1 start would render "Time TBA" on a listing that DID print a time —
  // the exact SF Station bug this project already fixed once. Drop instead.
  if (start < 0) return null;
  const end = L.times.length > 1 ? toMinutes(L.times[1]) : -1;

  const isFree = /^(free|donations?)$/i.test(L.price || "");
  const key = slug(title);

  return {
    id: `foopee-${L.date}-${key}-${slug(L.venue)}`,
    title,
    venue: L.venue,
    neighborhood: "San Francisco",
    address: "",
    description: "",
    image: "",
    date: L.date,
    startMinutes: start,
    endMinutes: end,
    timeLabel: timeRangeLabel(start, end),
    priceLabel: isFree ? "Free" : L.price,
    priceTier: isFree ? "free" : "unknown",
    categories: categorize(null, L.artists, "", L.venue),
    url: L.page,
    linkTier: "aggregator",
  };
}

function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 28);
}

export { foopee, parseListings, cityOf, isSF, toMinutes };