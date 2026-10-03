#!/usr/bin/env node
import { execFileSync } from "node:child_process";

// SF Pink Pages — a newspaper for the next three days.
//
// Pulls SF events from DoTheBay's public JSON (today/tomorrow feeds + every
// SF venue's own calendar, which reaches further out), normalizes them, drops
// sold-out and past events, links each one to the original venue or ticket
// page, and writes events.json.
//
// Run: node scrape.mjs

import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import * as CLEAN from "./title-clean.mjs";
import { isCancelledTitle } from "./shared.mjs";
import { hoodsOf } from "./hoods.mjs";
import { centerForTheBook, workshopSF, clayroom, scrap } from "./manual-venues.mjs";

const TZ = "America/Los_Angeles";
const DAYS = 3; // today + 2
const OUT = new URL("./events.json", import.meta.url);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "application/json" };

const j = async (url) => {
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

// Text variant, for the hand-kept venue pages in manual-venues.mjs. One
// fetcher per content type rather than a `j()` that guesses: a JSON parser
// pointed at an HTML page throws a SyntaxError that reads like a broken site.
const text = async (url) => {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

// A source that fails must say so. Before this, jSafe/tSafe returned null on
// any error and the run logged nothing — which is how a venue-index change can
// drop the feed from 191 events to 59 while every line of the log still reads
// as a clean run. Failures are counted and summarised at the end of the run
// instead, so a healthy source never adds noise but a broken one cannot hide.
const fetchFailures = new Map();

const noteFailure = (url, err) => {
  const why = String((err && err.message) || err).replace(/\s+/g, " ").trim();
  const prev = fetchFailures.get(url);
  if (prev) prev.n++;
  else fetchFailures.set(url, { n: 1, why });
};

export function fetchFailureReport() {
  if (!fetchFailures.size) return "";
  const rows = [...fetchFailures.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .map(([url, { n, why }]) => `    ${String(n).padStart(2)}x  ${why.padEnd(26)} ${url.slice(0, 88)}`);
  return `\n  ${fetchFailures.size} source fetch(es) failed — the run is NOT clean:\n${rows.join("\n")}\n`;
}

const jSafe = async (url) => {
  try { return await j(url); } catch (e) { noteFailure(url, e); return null; }
};
const tSafe = async (url) => {
  try { return await text(url); } catch (e) { noteFailure(url, e); return null; }
};

// Month abbreviation -> 0-based index. Needed by every source whose page shows
// "Oct 2" with no year, which is every Squarespace date badge.
const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Exported for manual-venues.mjs. `const` in an ES module is module-scoped and
// NOT visible to importers unless named here — the file imports back into this
// one, so anything it needs must be an explicit export or the import fails at
// link time with "does not provide an export named ...".
export { seen, out, MONTHS, parseTimeToMinutes, text, jSafe, tSafe };

// "18:30" or "6:30 PM" -> minutes past local midnight, or -1 when unknown.
function parseTimeToMinutes(t) {
  if (!t) return -1;
  const m = String(t).match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return -1;
  let hh = Number(m[1]);
  if (/pm/i.test(m[3] || "") && hh < 12) hh += 12;
  if (/am/i.test(m[3] || "") && hh === 12) hh = 0;
  return hh * 60 + Number(m[2]);
}

// ---------------------------------------------------------------------------
// Time — everything is normalized to America/Los_Angeles wall clock
// ---------------------------------------------------------------------------
const fmt = (opts) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, ...opts });
const p2 = (parts) => Object.fromEntries(parts.map((x) => [x.type, x.value]));

function today() {
  return p2(fmt({ year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()));
}
const iso = (p) => `${p.year}-${p.month}-${p.day}`;

function windowDays() {
  const out = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(Date.now() + i * 864e5);
    out.push(iso(p2(fmt({ year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d))));
  }
  return out;
}

// DoTheBay hands back `tz_adjusted_*` already in Pacific; the rest of the
// pipeline only ever sees { date, startMinutes, endMinutes, timeLabel }.
function laTime(isoStr, allDay = false) {
  if (allDay) return { date: isoStr.slice(0, 10), startMinutes: -1, endMinutes: -1, timeLabel: "All day" };
  const d = new Date(isoStr);
  if (isNaN(d)) return null;
  const p = p2(fmt({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d));
  const h = +p.hour % 24;
  const mer = h >= 12 ? "PM" : "AM";
  const h12 = (h % 12) || 12;
  return {
    date: iso(p),
    startMinutes: h * 60 + (+p.minute || 0),
    endMinutes: -1,
    // No space between the figure and the meridian. The old template had a
    // literal space there — "8:00 PM" — and the column's own flex gap added
    // another 5px on top of it, so the two read as "8:00  PM" with a gap no
    // single source produced. The meridian is a suffix to the figure, not a
    // separate token, so it sits against it: "8:00PM".
    timeLabel: +p.minute ? `${h12}:${String(+p.minute).padStart(2, "0")}${mer}` : `${h12}${mer}`,
  };
}

// One clock time, in the house style: "7:30 PM", "8 PM" (no ":00").
const clock = (mins) => {
  if (mins == null || mins < 0) return null;
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  const mer = h >= 12 ? "PM" : "AM";
  const h12 = (h % 12) || 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")} ${mer}` : `${h12} ${mer}`;
};

// The displayed time, and the one place that decides its SHAPE.
//
//   both ends known, same day -> "5 PM -- 8 PM"
//   both ends known, next day -> "10 PM -- 2 AM (+1)"
//   only a start               -> "8 PM"      (never a bare "TBA" if we know one end)
//   neither                    -> "Time TBA"
//
// The em-dash-as-two-hyphens separator is deliberate: "5 PM -- 8 PM" is ASCII, so
// it cannot be broken by a charset, and it reads as a newspaper en-dash rather
// than a minus sign. A range is only printed when the two ends actually differ;
// a zero-length or backwards span is a data error, not a range.
//
// `+1` is not decoration. 68 of 103 listings ended after midnight, and "8 PM --
// 2 AM" reads as an end that comes BEFORE the start — the reader has to stop
// and work out that the show finishes the following morning. The marker makes
// the wrap explicit at a glance, which is the difference between a listing you
// can read in half a second and one you have to check.
function timeRangeLabel(startMinutes, endMinutes) {
  const a = clock(startMinutes);
  const b = clock(endMinutes);
  if (!a) return "Time TBA";
  if (!b || b === a) return a;
  // endMinutes is kept in its own 0-1439 frame, so an end at or before the
  // start can only be the next calendar day.
  const nextDay = endMinutes <= startMinutes;
  return nextDay ? `${a} -- ${b} +1` : `${a} -- ${b}`;
}

const strip = (s, n = 240) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, n);

// Box-office prices resolved separately, keyed by event id. The
// file is written by a separate, slower browser pass and is absent on a cold
// checkout, so the read is guarded — the feed must still build without it.
const PRICE_OVERRIDES = (() => {
  try {
    return JSON.parse(readFileSync(new URL("./prices.json", import.meta.url), "utf8"));
  } catch {
    return {};
  }
})();

// Box-office links that a real browser confirmed return a 404. The upstream
// feed still points at them, so without this the page offers the reader a dead
// link with a live-looking label. The listing page is the correct fallback:
// it is the source's own record of the event, which is exactly the tier the
// "Link goes to" filter exists to surface. Two of 40 were dead at last run.
const DEAD_BOXOFFICE = (() => {
  try {
    const raw = JSON.parse(
      readFileSync(new URL("./prices-resolved.json", import.meta.url), "utf8")
    );
    return new Map((raw.dead || []).map((d) => [d.url, d.id]));
  } catch {
    return new Map();
  }
})();
// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------
// DoTheBay carries the artwork under `imagery.aws`, keyed by a preset name
// describing the crop. `cover_image_h_300_w_864` is the one worth pulling: it
// is a wide, short crop, which is what a masonry card wants, and it is the
// smallest of the usable presets. `imagery.photo` is a RELATIVE path
// ("v1789055114/event-17829117.jpg") with no documented prefix — every guess at
// a host for it 404s, so it is not usable and is deliberately ignored.
//
// Preference order is largest-desirable-first, then first hit, so adding a
// preset later never silently overrides a better one.
const IMAGE_PRESETS = [
  "cover_image_h_300_w_864",
  "cover_image_w_1200_h_450",
  "cover_image_h_250_w_680",
];

function eventImage(e) {
  const aws = e?.imagery?.aws;
  if (!aws || typeof aws !== "object") return null;
  for (const k of IMAGE_PRESETS) {
    const u = aws[k];
    // Only absolute https URLs: a relative path here would render as a broken
    // image on the site, which is worse than no image at all.
    if (typeof u === "string" && /^https:\/\/\S+$/i.test(u)) return u;
  }
  return null;
}

// Venue artwork, used when the event itself has none. Same `imagery` shape but
// on the venue record, and the value is relative — so it needs a host.
const VENUE_IMAGE_HOST = "https://assets0.dostuffmedia.com/uploads/venue_photos/";

function venueImage(venue) {
  const p = venue?.imagery?.default;
  return typeof p === "string" && p ? VENUE_IMAGE_HOST + p : null;
}

// ---------------------------------------------------------------------------
// Descriptions and titles — title-clean.mjs is the single source of truth
// ---------------------------------------------------------------------------
// cleanDescription and isElsewhere used to have a second, hand-copied
// implementation here, same as cleanTitle once did (see the note that used to
// sit on this line, and stayed true for these two after it stopped being true
// for cleanTitle): title-clean.mjs's DATELINE required no trailing pipe and
// test-titles.mjs exercised THAT version, while this file's own copy required
// a literal "|" to fire and was what actually shipped — a dateline with
// nothing after it (no venue, just a trailing comma or nothing) went out
// unstripped, and the tests stayed green throughout because they were
// checking the other copy. Both functions now delegate, so there is one
// definition and the tests describe what ships.
const cleanDescription = CLEAN.cleanDescription;
const cleanTitle = CLEAN.cleanTitle;
const isElsewhere = CLEAN.isElsewhere;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------------------------------------------------------------------------
// Where San Francisco is
// ---------------------------------------------------------------------------
// Venue selection is by geography, not by the `city` field: only 9 of DoTheBay's
// 447 listings carry one (the featured set), while 204 carry coordinates.
// The box is tightened against real SF city limits so Oakland across the Bay
// (Yoshi's, the Fox) and the Napa listings fall out.
const SF_BOX = { lat: [37.708, 37.812], lon: [-122.514, -122.357] };
const SF_CITY = /^san francisco$/i;
const inSF = (v) =>
  v.latitude && v.longitude &&
  SF_BOX.lat[0] <= v.latitude && v.latitude <= SF_BOX.lat[1] &&
  SF_BOX.lon[0] <= v.longitude && v.longitude <= SF_BOX.lon[1];

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
const CATEGORIES = [
  "Concerts & Music",
  "Film & Movies",
  "Theater & Dance",
  "Comedy",
  "Art & Exhibits",
  "Festivals & Fairs",
  "Food & Drink",
  "Sports & Fitness",
  "Talks & Workshops",
  "Family & Kids",
  "Community",
];

// DoTheBay's own category vocabulary maps straight across.
const MAP = {
  music: "Concerts & Music",
  comedy: "Comedy",
  "food & drink": "Food & Drink",
  "theatre & performing arts": "Theater & Dance",
  film: "Film & Movies",
  lgbtq: "Community",
  variety: "Theater & Dance",
  "sports & wellness": "Sports & Fitness",
  "arts & culture": "Art & Exhibits",
  "free & cheap": "Community",
  family: "Family & Kids",
  nightlife: "Concerts & Music",
};

// Keyword fallback. These run on title + short excerpt, and the order matters:
// the first match per category wins, so a specific test claims the event before
// a broad one can. "class" and "show" are deliberately excluded — they pulled
// film screenings into Talks & Workshops and every concert into Family & Kids.
const KEYWORDS = [
  [/stand-?up|comedy|comedian|improv|sketch show|late show|open mic.*comedy|variety/, "Comedy"],
  [/cinema|movie|screening|film series|new release|double feature|\bfilm\b|\bdrafthouse\b/, "Film & Movies"],
  [/theatre|theater|\bplay\b|musical|ballet|opera|\bdance\b|recital|choreograph|karaoke/, "Theater & Dance"],
  [/concert|live band|album release|\bgig\b|singer|songwriter|open mic|\bdj\b|headliner|orchestra|jazz/, "Concerts & Music"],
  [/gallery|gallery exhibit|museum|exhibit|art show|opening reception|artist talk|arts & culture/, "Art & Exhibits"],
  [/festival|\bfair\b|market|carnival|parade|block party|street fair|night market/, "Festivals & Fairs"],
  [/food|drink|brunch|dinner|wine|tasting|beer|cocktail|pairing|\bcook(?:ing)?\b|supper|\btea\b/, "Food & Drink"],
  [/yoga|fitness|workout|\brun\b|running|hike|hiking|bike|cycling|climb|meditat|wellness|swim|sports? &/, "Sports & Fitness"],
  [/workshop|panel|lecture|\btalk\b|seminar|training|coaching|salon|discussion|book club|community meeting/, "Talks & Workshops"],
  [/kids|children|family|toddler|all ages|playground|storytime|puppet|preschool/, "Family & Kids"],
  [/volunteer|cleanup|clean up|community|neighborhood|fundraiser|charity|civic|benefit/, "Community"],
];

// Legal and admissions boilerplate. These words sit in copy about getting into
// the room, not about what happens in it, and they were firing categories on
// events they have nothing to do with.
//
// The clearest case was a 21+ rap show tagged "Family & Kids". Nothing about it
// was family-friendly; the tag came from the venue's own admissions clause — in
// ticket copy "All Ages" means ages 6 and up, so it is a DISCLAIMER, not an
// offer. A phrase with inverted polarity fires any keyword list it appears in,
// and "all ages" sat inside the Family & Kids regex with no way to tell "kids
// welcome" from "not for little kids".
//
// Removed before categorization rather than merely excluded from the result,
// because the same text would otherwise re-trigger the keyword pass every run.
const BOILERPLATE =
  /\b(?:all ages(?: admission)?|21 and (?:over|plus)|ages? 21\+|21\+|valid (?:photo )?id(?: required)?|id required|no (?:photo )?id|box office(?: window)?|will call(?: window)?|doors? (?:open|at)\b[^.]{0,24}|admission(?: (?:is|includes|prices?))?|free admission|required purchase|no re-?entry|tickets? (?:are|available)\b[^.]{0,24}|capacity|limited (?:seating|availability)|unclaimed tickets?|ticket(?:s)? required)\b/gi;

// Categories in descending order of how confidently the keyword pass assigns
// them. This ORDER is what decides which tags survive the cap, so it encodes
// the editorial rule: an event is what it is primarily for, and the incidental
// venue around it is not a second category.
const CATEGORY_RANK = {
  "Concerts & Music": 0,
  "Film & Movies": 1,
  "Theater & Dance": 2,
  Comedy: 3,
  "Festivals & Fairs": 4,
  "Art & Exhibits": 5,
  "Family & Kids": 6,
  "Food & Drink": 7,
  "Sports & Fitness": 8,
  "Talks & Workshops": 9,
  Community: 10,
};

// Evidence weight given to a category whose keyword appears in the TITLE.
// The title is what the event is; a passing mention in a paragraph is context.
const TITLE_MATCH = 0.34;

// How much of the listing's text supported this tag, as evidence-per-word.
// A ratio rather than a count on purpose: a concert listing that says "bar"
// once in 140 words is not a Food & Drink event, and a raw occurrence count
// would happily call it one.
function evidenceRatio(hay, re) {
  const words = (hay.match(/\S+/g) || []).length;
  if (!words) return 0;
  const hits = hay.match(new RegExp(re.source, "gi")) || [];
  return hits.length / words;
}

// Build a case-insensitive matcher for one literal, escaping regex characters.
// The venue's own name is the other constant source of wrong tags: "Cafe du
// Nord" contains "cafe", which put Food & Drink on every concert held there.
const literalRe = (s) =>
  new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "gi");

// `description` MUST be the same string the card renders — pass the output of
// cleanDescription(), never the raw excerpt. Tags derived from raw text are
// justified by words the reader never sees, and the two disagree: one listing
// was tagged Comedy/Theater/Food from copy that the card does not show.
function categorize(rawCategory, title, description, venueName) {
  const mapped = MAP[(rawCategory || "").toLowerCase().trim()];
  const set = new Set();
  if (mapped) set.add(mapped);

  // Strip boilerplate and the venue echo BEFORE matching keywords, so "All Ages"
  // in an admissions clause cannot fire Family & Kids and a venue named for a
  // cafe cannot fire Food & Drink on its own concerts.
  let hay = `${title || ""} ${description || ""}`;
  hay = hay.replace(BOILERPLATE, " ");
  if (venueName) hay = hay.replace(literalRe(venueName), " ");
  hay = hay.toLowerCase();

  const titleLower0 = String(title || "").toLowerCase();

  for (const [re, cat] of KEYWORDS) if (re.test(hay)) set.add(cat);

  if (!set.size) return [mapped || "Community"];

  // A SINGLE candidate is not automatically correct. "Tobi Lou" matched no
  // keyword at all, so the one incidental "bar" in its blurb was the only thing
  // Food & Drink had to stand on — and an earlier version short-circuited here
  // and shipped it. There is no second tag to weigh it against, so the test has
  // to be absolute rather than relative: with nothing else in the running, a
  // tag has to be named by the title or asserted by the source to survive on
  // its own. Otherwise the event is filed as what it plainly is and the weak
  // tag is dropped.
  if (set.size === 1) {
    const only = [...set][0];
    if (only === mapped) return [only]; // the publisher says so
    const rule = KEYWORDS.find(([, c]) => c === only);
    if (rule && rule[0].test(titleLower0)) return [only];
    return [mapped || "Community"];
  }

  // More than one candidate. Score each, then keep the best. Two rules:
  //   - the source's own `category` field is the publisher's assertion about
  //     what the event IS, and is never discarded on keyword evidence alone;
  //   - otherwise a tag has to earn its place, and a tag whose only evidence is
  //     one incidental word is dropped.
  const titleLower = String(title || "").toLowerCase();
  const scored = [...set].map((cat) => {
    const rule = KEYWORDS.find(([, c]) => c === cat);
    let evidence = 0.5; // asserted by the source's category field
    if (rule) {
      evidence = evidenceRatio(hay, rule[0]);
      if (rule[0].test(titleLower)) evidence += TITLE_MATCH;
    }
    return {
      cat,
      rank: CATEGORY_RANK[cat] ?? 99,
      evidence,
      asserted: cat === mapped,
    };
  });

  // Credibility is RELATIVE, not absolute. A fixed floor had to be tuned per
  // listing length — one incidental "bar" in a 60-word concert blurb cleared
  // 0.02, while the same word in a 400-word one did not — which is the wrong
  // shape entirely: the question is not "how long is this listing" but "how much
  // of what this listing is about is this category".
  //
  // So: a tag survives if the source asserted it, or if the title names it, or
  // if it holds at least a third of the strongest tag's evidence. A concert
  // named in its own title scores 0.34 and a lone "bar" scores ~0.01, so the
  // bar tag is out by an order of magnitude. A farmers-market dinner repeats
  // wine/tasting/pairing and scores near the top on its own density, so
  // nothing is lost by keeping it.
  const best = Math.max(...scored.map((s) => s.evidence), 0);
  const kept = scored
    .filter((s) => s.asserted || s.evidence >= best * 0.33 || s.evidence > 0.12)
    .sort((a, b) => b.evidence - a.evidence || a.rank - b.rank);

  // The cap. Two at most, most relevant first — a concert that happens to have
  // a bar is not a Food & Drink event, and the reader scanning 150 cards needs
  // the primary tag visible without opening anything.
  const result = kept.slice(0, 2).map((s) => s.cat);

  // If the evidence filter removed everything, the event still is something;
  // fall back to the source's own call, then to Community.
  if (!result.length) return [mapped || "Community"];
  return result;
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------
// The API carries a structured ticket_info field ("$40-$45, All Ages",
// "Free, All Ages") that beats regexing prose. Prose is the fallback for
// listings that leave it blank.
const FREE_WORDS = /\b(free|no cover|free admission|complimentary|free entry)\b/i;

// Price resolution stays INLINE here rather than delegating to shared.priceFrom.
// Delegating looked like the right de-duplication — this function was a full
// copy of it — but the two are not actually equivalent: DoTheBay's `is_free`
// is tri-state (true / false / absent) and its "Ticketed" tier is a deliberate
// third answer that shared.priceFrom has no equivalent for. Routing through it
// flipped a real event from "Ticketed" to "Free", because a listing whose copy
// contains the word "free" somewhere took a different path. Reverted; the
// duplicate stays, and the two range gates below are applied to it so this copy
// no longer ships a table price as the door price.
function priceOf(e) {
  if (e.is_free) return { label: "Free", tier: "free" };

  // Reject an unbelievable range: a VIP table minimum scraped out of the copy
  // is not the cost of admission. "$15-$800" shipped from this exact code.
  const rangeOk = (lo, hi) => {
    const a = parseFloat(lo), b = parseFloat(hi);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (a <= 0 || b <= 0 || a > 1500 || b > 1500) return false;
    return Math.max(a, b) / Math.min(a, b) <= 40;
  };

  const info = e.ticket_info || "";
  if (info) {
    const range = info.match(/\$\s?(\d{1,4}(?:\.\d{2})?)\s?(?:-|–|—|to)\s?\$?\s?(\d{1,4}(?:\.\d{2})?)/);
    if (range && rangeOk(range[1], range[2]))
      return { label: `$${range[1]}–$${range[2]}`, tier: "paid" };

    const one = info.match(/\$\s?(\d{1,4}(?:\.\d{2})?)/);
    if (one) {
      const n = parseFloat(one[1]);
      if (n === 0) return { label: "Free", tier: "free" };
      return { label: `$${n % 1 ? n.toFixed(2) : n}`, tier: "paid" };
    }
    if (/\bfree\b/i.test(info)) return { label: "Free", tier: "free" };
  }

  // A price resolved at the box office itself, which
  // beats anything scraped from the listing copy — see that file for why the
  // copy cannot be trusted on its own.
  if (PRICE_OVERRIDES[String(e.id)]?.label)
    return { label: PRICE_OVERRIDES[String(e.id)].label, tier: "paid" };

  // Fall back to the copy when ticket_info is absent.
  const text = strip(e.excerpt || "") + " " + strip(e.description || "");
  const range = text.match(/\$\s?(\d{1,4}(?:\.\d{2})?)\s?(?:-|–|—|to)\s?\$?\s?(\d{1,4}(?:\.\d{2})?)/);
  if (range && rangeOk(range[1], range[2]))
    return { label: `$${range[1]}–$${range[2]}`, tier: "paid" };

  const one = text.match(/\$\s?(\d{1,4}(?:\.\d{2})?)/);
  if (one) {
    const n = parseFloat(one[1]);
    if (n === 0) return { label: "Free", tier: "free" };
    // Ignore year-like and zip-like numbers scraped out of prose.
    if (n > 1500) return { label: null, tier: "unknown" };
    return { label: `$${n % 1 ? n.toFixed(2) : n}`, tier: "paid" };
  }

  if (FREE_WORDS.test(text)) return { label: "Free", tier: "free" };

  // The API sets `is_free: false` on every ticketed listing, including the
  // cinema ones whose `ticket_info` is blank. That is real venue data: the
  // event is definitely not free, we just could not read the amount. Calling
  // that "unknown" lumped 12 genuinely ticketed films in with listings that
  // simply never state a price, and the reader could not tell which was which.
  // So it gets its own tier — the number is not known, but the answer to
  // "is this free?" is definitely no.
  //
  // The word is "Ticketed" rather than a number on purpose. 39 of the 40 are
  // behind a bot wall (Veezi, SF Center) or on an organizer homepage rather
  // than a ticket page, and the only prices findable there belong to a
  // DIFFERENT ticket — a double feature, or the organizer's cheapest night.
  // Printing a number here would be a guess dressed as a fact, on a page whose
  // entire claim is that it links you to the real thing. "Ticketed" is the
  // honest answer, and the row links straight to the box office for the amount.
  if (e.is_free === false) return { label: "Ticketed", tier: "ticketed" };

  return { label: null, tier: "unknown" };
}

// ---------------------------------------------------------------------------
// Venue must be in San Francisco
// ---------------------------------------------------------------------------
// The citywide feeds are Bay-Area-wide, so Oakland/Berkeley/Napa listings come
// through them. Geo is the reliable signal; the city field is checked too
// because a few venues carry one with no coordinates.
//
// The address fallback is a LAST resort and must not reject on absence of
// evidence. It required the literal words "San Francisco" in the address, but a
// real San Francisco address does not contain them: "1310 Haight St" is
// Workshop, "2261 Market St" is a gallery, "1 Ferry Building" is a market.
// Measured: 225 of 447 venues were dropped on that test alone, including
// Workshop, the Ferry Building, the Savoy Tivoli and the Kink Store — while
// the genuinely out-of-area ones (The Meritage Resort and Spa Napa, San Jose
// Civic, Oracle Park) are correctly excluded.
//
// So: reject only on positive evidence of being elsewhere. A venue we cannot
// place is admitted, and the event's OWN venue record — which the calendar
// response carries with a real city — decides in `add()`. Nothing is admitted
// that its own record places outside the box.
function venueInSF(v) {
  if (!v) return true; // no venue data — citywide feed already filtered by date
  if (v.city) return SF_CITY.test(v.city.trim());
  if (v.latitude != null && v.longitude != null) return inSF(v);
  const a = `${v.address || ""} ${v.full_address || ""}`;
  if (!a.trim()) return true;
  // Positive evidence only. A city named in the address is authoritative either
  // way: "Oakland 94607" is out, an unlabelled street address is not a verdict.
  const named = /\b(san francisco|oakland|berkeley|napa|sausalito|daly city|san jose|alameda|san mateo|palo alto|santa clara|walnut creek|marin|sonoma|napa valley|san rafael|fremont|sunnyvale|santa cruz|petaluma|novato|concord|antioch|vallejo|fairfield|richmond|hayward|union city)\b/i;
  const m = a.match(named);
  if (!m) return true; // no city named — undecided, not excluded
  return SF_CITY.test(m[1]);
}

// ---------------------------------------------------------------------------
// Finding the venue's own page
// ---------------------------------------------------------------------------
// When a listing has no outbound ticket link we would otherwise fall back to
// the aggregator's own page, which is exactly what this site must not send
// people to. The organizer's URL is almost always sitting in the event copy —
// a "buy tickets" or "register" link, or the venue's site in a plain anchor.
// Prefer the venue's root domain over a ticketing middleman.
// Lists that are pure aggregators — a page *about* an event, run by someone who
// is not the venue. These are the only hosts we refuse to send a visitor to.
// `evyy.net` is deliberately absent: it is Ticketmaster's redirect wrapper, not a
// listing page, so it belongs with the sellers below. `eventbrite.com` and
// `universe.com` belong there too — they host the page the organizer published
// and sold. Listing them here as well put them in both sets, and because this
// test runs first it silently downgraded real venue pages to the aggregator
// tier. One host, one meaning: if a name appears in both lists, the row gets
// the worse label for no reason.
// Shortener and tracking hosts. The subdomain prefix must be OPTIONAL and
// quantified (`(.+\.)?`), not `(.|\.)`: the latter needs a character before the
// dot, so it never matches a bare "bit.ly" or "t.co" — the two most common
// cases — and silently passes every real shortener straight through.
const SHORTENER_RE =
  /(.+\.)?(bit\.ly|pxf\.io|t\.co|lnkd\.in|goo\.gl|ow\.ly|is\.gd|buff\.ly|tinyurl\.com|cutt\.ly|t\.ly)$/i;

// Hosts whose page is an AGGREGATOR's, not the venue's or organizer's.
// eventbrite.com and eventbrite.* were missing here, which let 11 rows through
// as if they were first-party links: the reader was told "venue site" and sent
// to an aggregator. That is the exact failure the brief forbids.
//
// The subdomain prefix must be OPTIONAL and quantified (`(.+\.)?`), not `(.|\.)`:
// the latter needs a character before the dot, so it never matches a bare host.
//
// eventbrite also serves localised domains (eventbrite.co.uk, .de, .fr) and
// bare subdomains (www, m, checkout), so the suffix is anchored rather than
// enumerated.
const AGGREGATOR_HOSTS =
  /(.+\.)?(dothebay\.com|dostuffmedia\.com|eventbrite\.[a-z.]{2,6}|dostuff\.com|allevents\.in|evvys\.com|sfweekly\.com|sfchronicle\.com|funcheap\.com|eventup\.com|patch\.com|do512\.com|bit\.ly|pxf\.io|t\.co|is\.gd|lnkd\.in|buff\.ly|tinyurl\.com)$/i;

// Hosts that SELL tickets for the venue, on the venue's behalf. When the venue
// has no site of its own this is the closest thing to one, so it is kept and
// labelled "box office". This deliberately includes white-label sellers such as
// `wl.seetickets.us` — those are the venue's official outlet, not an aggregator,
// and rejecting them used to push events onto the aggregator page instead.
const TICKETING_HOSTS =
  /(^|\.)(ticketmaster\.(com|evyy\.net)|axs\.com|shop\.axs\.com|seetickets\.(us|com|co\.uk|net)|wl\.seetickets\.[a-z.]+|veezi\.com|veezi\.tv|ticketing\.uswest\.veezi\.com|dice\.fm|scuff\.us|dnnr\.io|feourala\.com|showsafe\.com|onebox\.tickets|eventbrite\.com|vbz\.com)$/i;

// Pull candidate anchors out of the raw HTML, keeping only http(s).
// Decode the HTML entities that leak out of scraped markup. `&amp;` is the
// common one, but sources also emit numeric references (`&#038;`, `&#x26;`),
// and a URL carrying one literally is broken: the query string reaches the
// destination with `&#038;` in it instead of `&`, which drops every parameter
// after the first. Three Eventbrite links were affected.
const HTML_ENTITIES = {
  "&amp;": "&", "&#038;": "&", "&#x26;": "&", "&quot;": '"', "&#39;": "'",
  "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&#160;": " ",
};

// Decode a numeric character reference, decimal or hex. Word joins are the
// common case in real listing titles — "Beginner&#8217;s" was published with
// the raw reference visible on the page — so this is a general numeric decoder,
// not another entry in the table above. An allowlist cannot keep up: every
// punctuation mark Word emits is a different code point. Unknown code points
// (above 0x10FFFF, or a lone surrogate) are left intact rather than turned into
// a replacement character, so nothing is silently destroyed.
function fromCodePoint(cp) {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return null;
  if (cp >= 0xd800 && cp <= 0xdfff) return null;
  try {
    return String.fromCodePoint(cp);
  } catch {
    return null;
  }
}

function decodeEntities(s) {
  return String(s)
    // Numeric first: &#8217; and &#x2019; both mean U+2019.
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (m, body) => {
      const cp = body[0] === "x" || body[0] === "X"
        ? parseInt(body.slice(1), 16)
        : parseInt(body, 10);
      return fromCodePoint(cp) ?? m;
    })
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m);
}

// Exported for manual-venues.mjs. Tribe's REST v1 returns `title` and `excerpt`
// as PLAIN STRINGS with entities still in them, while the WP REST convention is
// `{rendered: "..."}`. A reader that only handles one shape silently yields an
// empty string for the other, and an empty title is then dropped by the
// `if (!title) continue` guard below — a whole venue publishing nothing with no
// error anywhere. That is exactly what happened to Workshop SF.
export { decodeEntities, register };

// Prefer https, but only where the host actually serves it. A blind scheme
// rewrite would break every venue still on http-only, so each host is probed
// once and the answer cached — a link a visitor clicks has to work, and a
// forced https on a host without TLS is a dead link.
const tlsCache = new Map();

function servesHttps(host) {
  if (tlsCache.has(host)) return tlsCache.get(host);
  let ok = false;
  try {
    // Any HTTP status counts: a 404 still proves the TLS handshake completed.
    const code = execFileSync("curl", ["-sI", "--max-time", "6", "-o", "/dev/null",
      "-w", "%{http_code}", `https://${host}/`], { encoding: "utf8", timeout: 8000 }).trim();
    ok = /^[1-9]\d\d$/.test(code);
  } catch { ok = false; }
  tlsCache.set(host, ok);
  return ok;
}

function safeUrl(href) {
  try {
    const u = new URL(decodeEntities(href));
    // Only ever hand out http(s); a javascript: or data: href from scraped
    // markup must not survive into the page.
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Upgrade to https where the host supports it, so the site never ships an
    // unencrypted link to a venue that has TLS.
    if (u.protocol === "http:" && servesHttps(u.hostname)) u.protocol = "https:";
    return u;
  } catch {
    return null;
  }
}

// Some buy links are tracking wrappers that carry the real destination in a
// query parameter (?u=, ?redirect=, ?url=). Unwrap so the link a person clicks
// points at the venue or its box office rather than a redirector.
// Hosts that only ever wrap someone else's real URL. The `?u=` form is decoded
// locally; the HTTP-redirect form (bit.ly and friends) has to be followed, since
// the true destination is not in the URL at all. Following is capped and only
// applies to known shorteners so a normal link is never fetched.
const REDIRECT_HOSTS = SHORTENER_RE;

function followShortener(u) {
  if (!REDIRECT_HOSTS.test(u.hostname)) return u;
  let cur = u.toString();
  for (let i = 0; i < 5; i++) {
    let next = null;
    try {
      const req = new Request(cur, { method: "GET", redirect: "follow" });
      // A HEAD is cheaper, but some shorteners 405 it; the body is never read.
      const res = fetchSync(req);
      next = res?.url || null;
    } catch {
      next = null;
    }
    if (!next || next === cur) break;
    const nu = safeUrl(next);
    if (!nu) break;
    cur = nu.toString();
    if (!REDIRECT_HOSTS.test(nu.hostname)) break; // reached the real destination
  }
  return safeUrl(cur) || u;
}

// Small synchronous HTTP HEAD helper. Node has no sync fetch, so this shells out
// to curl, which is present everywhere this runs and needs no dependency.
function fetchSync(req) {
  try {
    const out = execFileSync("curl", ["-sIL", "--max-time", "8", "-o", "/dev/null",
      "-w", "%{url_effective}", req.url], { encoding: "utf8", timeout: 9000 });
    return out ? { url: out.trim() } : null;
  } catch {
    return null;
  }
}

function unwrapTracker(href) {
  const u = safeUrl(href);
  if (!u) return null;

  for (const key of ["u", "url", "redirect", "target", "to", "dest"]) {
    const raw = u.searchParams.get(key);
    if (!raw) continue;
    let inner = raw;
    try { inner = decodeURIComponent(raw); } catch { /* already decoded */ }
    // Only accept an absolute http(s) target, and never recurse into another
    // wrapper on the same host.
    if (/^https?:\/\//i.test(inner)) {
      const iu = safeUrl(inner);
      if (iu && iu.hostname !== u.hostname) return followShortener(iu);
    }
  }
  return followShortener(u);
}

function anchorsIn(html) {
  const out = [];
  const re = /href=["'](https?:\/\/[^"'>\s]+)["']/gi;
  let m;
  while ((m = re.exec(html || ""))) {
    const u = safeUrl(m[1]);
    if (u) out.push(u);
  }
  return out;
}

// Does this host look like the venue's own site rather than a seller?
function isVenueSite(url, venueName) {
  if (AGGREGATOR_HOSTS.test(url.hostname)) return false;
  if (TICKETING_HOSTS.test(url.hostname)) return false;

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const parts = host.split(".");
  const core = parts.slice(0, -2).join("."); // drop tld + second-level

  // A ticket path on the venue's own domain is still the venue's page.
  if (venueName) {
    const v = venueName.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const c = core.replace(/[^a-z0-9]+/g, "");
    if (c && (c.includes(v) || v.includes(c))) return true;
  }
  return true; // a plain non-ticketing site beats an aggregator page
}

function venuePageFrom(html, venueName) {
  // Returns the URL OBJECT, not a string. linkTier() below reads
  // outbound.hostname to decide venue/boxoffice/listing — a string's
  // .hostname is undefined, which silently skipped the AGGREGATOR_HOSTS/
  // SOCIAL_HOSTS/TICKETING_HOSTS checks for every link sourced from an
  // event's own copy and always fell through to "venue". A description that
  // links to the venue's Facebook or Instagram page (common — "RSVP on
  // Facebook") would badge that as "Venue site" and send the reader to a
  // login wall, exactly the failure isVenueSite/linkTier's own comments say
  // is handled. Confirmed nothing in today's feed happened to hit it; the
  // gap existed regardless.
  for (const u of anchorsIn(html)) {
    if (isVenueSite(u, venueName)) return u;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Where a listing actually sends you
// ---------------------------------------------------------------------------
// Three tiers, because "the venue's own page" has more than one honest answer:
//   venue  — the venue or organizer's own website
//   boxoffice — a ticketing seller acting as that venue's official box office
//   listing — the aggregator's page, used only when nothing else exists
// The page shows which one you are clicking.
// A social profile is where an event gets *announced*, not where tickets are
// sold and not the venue's own page. Badging it "venue site" is a lie the
// reader can see through, and a Facebook login wall is a worse dead end than an
// honest listing page. These are demoted to "listing" so the badge matches.
const SOCIAL_HOSTS =
  /(^|\.)(facebook\.com|instagram\.com|twitter\.com|x\.com|threads\.net|bsky\.app|linkedin\.com|meetup\.com|youtube\.com|tiktok\.com|tumblr\.com|mastodon\.social|bsky\.social)$/i;

// Venues whose own site is known but which the source publishes no URL for:
// `buy_url` is null, no anchor in the copy, nothing in the venue description.
// These were resolved by searching the venue's *street address* — a name alone
// is ambiguous ("Monarch" is a Colorado casino) — and then confirmed by
// hand: each URL was fetched and its page title checked against the venue.
//
// Deliberately absent: lowerpolkcbd.org. The Lower Polk CBD is the district's
// business association, not the organiser of the Art Walk, so it is not the
// venue's own page and does not belong here. Rye Bar and Pop's Bar have no
// record in the venue source at all, so there is no address to anchor on and
// no safe way to resolve them.
const VERIFIED_VENUE_URLS = {
  "gray area": "https://grayarea.org/",
  "sf lgbt center": "https://sfcenter.org/",
  "mission bowling club": "https://www.missionbowlingclub.com/",
  "artists' television access": "https://www.atasite.org/",
  "noe valley town square": "https://noevalleytownsquare.com/",
};

function verifiedVenueUrl(venueName) {
  if (!venueName) return null;
  const k = venueName.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  return VERIFIED_VENUE_URLS[k] || null;
}

function linkTier(url, venueName) {
  if (!url) return "listing";
  if (AGGREGATOR_HOSTS.test(url.hostname)) return "listing";
  if (SOCIAL_HOSTS.test(url.hostname)) return "listing";

  if (TICKETING_HOSTS.test(url.hostname)) {
    // Some sellers host the venue's site themselves (axs.com/venue, etc.).
    const core = url.hostname.replace(/^www\./, "").toLowerCase().split(".").slice(0, -2).join(".");
    if (venueName) {
      const v = venueName.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const c = core.replace(/[^a-z0-9]+/g, "");
      if (c && (c.includes(v) || v.includes(c))) return "venue";
    }
    return "boxoffice";
  }
  return "venue";
}

// ---------------------------------------------------------------------------
// Where a venue's own page comes from
// ---------------------------------------------------------------------------
// Preference, in order:
//   1. a venue site linked in the event's own copy
//   2. the buy link, with tracking wrappers unwrapped and pure aggregators
//      rejected — a venue's official seller (Ticketmaster, AXS, See Tickets)
//      counts as the box office, which is the closest thing to a venue page
//   3. the aggregator's listing, which is the honest last resort
//
// There is deliberately no fourth step that guesses a venue's homepage from a
// web search. That approach was built and measured against a known-good answer
// for six venues and got one right, three wrong (a Colorado casino called
// Monarch, a community-health site for the LGBT Center, a city planning
// document for the Hunters Point artists) and two misses — worse than not
// trying, because a wrong link is a worse failure than an honest listing page.
// So an event whose source carries no link keeps its listing page and is
// badged "Listing page" rather than being sent somewhere unverified.
//
// The cases this would fix are venues that publish no URL at all: community
// centres, arts collectives, and free recurring programmes. Reaching them
// means a per-venue source with its own address and contact details, not a
// search.

// ---------------------------------------------------------------------------
// One event -> the shape the page consumes
// ---------------------------------------------------------------------------
// Sold-out listings are the one category a reader most wants gone: the paper's
// whole job is "go to this tonight", and a sold-out show is not a choice. The
// flag is carried through rather than dropping the event, so the page can
// filter it live and the count stays honest.
// The ONLY trusted signal is the source's own flag. Matching on the event copy
// was wrong in both directions: "this tour included sold-out shows nationwide"
// is the artist's back-catalogue, not tonight's ticket status, and it silently
// removed two genuinely available concerts.
const SOLD_OUT_RE =
  /\b(sold[\s‐-]?out|sell(?:ed)?[\s‐-]?out|out of stock|no (?:more )?(?:tickets|seats) (?:available|remaining)|at capacity|fully booked)\b/i;

function soldOut(e, raw = "") {
  if (e.sold_out === true || e.sold_out === "true") return true;
  if (e.soldOut === true || e.soldOut === "true") return true;

  // A copy-level match counts only when it is a *status statement* about this
  // event: it has to sit at the start of a line or follow a sentence break,
  // and it must not be qualifying a past tour. "Sold-out shows nationwide" and
  // "previously sold out" are history; "SOLD OUT." is not.
  const m = String(raw || "").match(SOLD_OUT_RE);
  if (!m) return false;

  // Sentence-scoped, not window-scoped. The historical evidence is often far
  // from the phrase and on either side of it: "…co-headline tour… which
  // included sold-out shows nationwide…" puts "tour" 110 characters back and
  // "nationwide" 20 forward, so a fixed window can never see it. Take the
  // whole sentence and judge that.
  const raw2 = String(raw || "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // Re-find the phrase in the cleaned text: tag-stripping shifts every offset.
  const hit2 = SOLD_OUT_RE.exec(raw2);
  if (!hit2) return false;
  const at = hit2.index;

  const start = Math.max(
    raw2.lastIndexOf(".", at - 1) + 1,
    raw2.lastIndexOf("!", at - 1) + 1,
    raw2.lastIndexOf("?", at - 1) + 1,
    raw2.lastIndexOf("\n", at - 1) + 1,
    0);
  let end = raw2.length;
  for (const ch of [".", "!", "?", "\n"]) {
    const i = raw2.indexOf(ch, at);
    if (i !== -1) end = Math.min(end, i);
  }
  const sentence = raw2.slice(start, end).trim();
  const hay = sentence.toLowerCase();

  // Present-tense, about this event.
  if (/\b(this|these)\s+(show|gig|event|performance|concert|one|tickets?)\b/.test(hay)) return true;
  if (/\b(tickets?|seats?|admission)\b[^.!?]{0,30}\b(are|is|were|has|have|had)\b/.test(hay)) return true;

  // A phrase immediately followed by a question mark is a question, not a
  // status: "Sold out? Ask about returns at the door" is an invitation to ask.
  if (raw2[at + hit2[0].length] === "?") return false;

  // Otherwise the sentence is history unless it talks about tonight. The
  // historical test runs before the positive one below because a marker can
  // sit anywhere in the sentence: "their 2019 RUN of sold-out dates" puts the
  // year first and the noun last, so neither a prefix nor a suffix check
  // catches it. A live status sentence names *this* event and a year rarely
  // appears at all, so requiring "no year anywhere" is the safe direction.
  //
  // These all run BEFORE the short-banner shortcut below. A one-line promo is
  // exactly the shape most likely to be about something else — a past show, a
  // record, a record-breaking run — so length has to be the last resort, not
  // the first.
  if (/\b(prev|previous|last|prior|past|formerly|once|earlier|since|through|co-?headline|back-?catalogue|catalogue|tour|tours|nationwide|national|history|previously|record[- ]breaking|landmark|record[- ]set|album|discography|returns?|returning|reprise|revival|again|re-?issue|archive|encore)\b/.test(hay)) return false;
  if (/\b(19|20)\d{2}\b/.test(hay) || /\b(19|20)\d{2}\b/.test(raw2)) return false;

  // Conditional or hypothetical: "when tickets sell out", "join the waitlist
  // if it sells out" describe a future possibility, not this listing's state.
  if (/\b(when|if|unless|should|would|could|might|may|hope|hopefully|wait ?list|rain ?check|how|why)\b/.test(hay)) return false;

  // "sell out" with a non-ticket subject is an observation about the world
  // ("popular artists sell out fast"), not a statement about tonight.
  if (/\bsell(?:s|ing)?\s*out\b/i.test(hay)
      && !/\b(tickets?|seats?|passes|admission|entry|shows?|concerts?|gigs?)\b/i.test(hay)) return false;

  // Nothing above objected: a short standalone phrase is a status banner
  // ("SOLD OUT."), and a longer one is a claim about this listing.
  return true;
}

function normalize(e, venue) {
  if (!venueInSF(venue || e.venue)) return null;
  const t = laTime(e.tz_adjusted_begin_date || e.begin_time);
  if (!t) return null;

  // The end time, when the source publishes one. `tz_adjusted_end_date` is the
  // authoritative field; `end_time` is the un-adjusted twin and is already
  // Pacific for these feeds, so it is only a fallback.
  //
  // The end often lands on the NEXT calendar day (a 8 PM show ending 2 AM), so
  // a naive end-minus-start would be negative. A negative span is treated as
  // next-day and the end is kept in its own 0-1439 frame — the label is
  // "8 PM -- 2 AM", never "8 PM -- -6 AM".
  const endIso = e.tz_adjusted_end_date || null;
  if (endIso) {
    const te = laTime(endIso);
    if (te && te.startMinutes >= 0) {
      t.endMinutes = te.startMinutes;
      // Sanity: a span over ~8h is a data error, not a performance. The first
      // cap was 14h, which let a 12h "2 PM -- 2 AM" through: Renée Fleming is a
      // real 2 PM concert, but the venue's end time of 2 AM the next morning is
      // the building closing, not the show. Printed as a range it reads as a
      // twelve-hour opera. 8h keeps every genuine case here (the longest real
      // span in the feed is 6h) and drops the venue-closing ones.
      let span = te.startMinutes - t.startMinutes;
      if (span < 0) span += 1440;
      if (span > 8 * 60) t.endMinutes = -1;
    }
  }
  t.timeLabel = timeRangeLabel(t.startMinutes, t.endMinutes);

  if (e.past) return null;
  if (/private|buyout|closed for/i.test(e.title || "")) return null;

  const price = priceOf(e);
  const venueName = venue?.title || e.venue?.title || null;

  // The venue's own page is the record we want to send people to. Preference:
  // a venue site found in the copy, then a buy link that is not an aggregator.
  // A ticketing middleman (Ticketmaster, AXS, Dice…) is still the venue's
  // official box office when the venue has no page of its own, so it stays.
  // Only when neither exists do we fall back to the aggregator page itself.
  const copyVenue = venuePageFrom(e.description, venueName);
  const buy = unwrapTracker(e.buy_url);
  const buyOk = buy && !AGGREGATOR_HOSTS.test(buy.hostname) ? buy : null;

  // A box office confirmed dead by a real browser is worse than no link: the
  // reader clicks "box office" and gets a 404. Fall back to the source's own
  // listing, which is the aggregator tier the page already labels honestly.
  // Verified URLs are exempt — they were checked by hand, not by the probe.
  const buyLive = buyOk && !DEAD_BOXOFFICE.has(buyOk.href) ? buyOk : null;
  // outbound must stay a URL object (or null), never a bare string: linkTier()
  // reads outbound.hostname. safeUrl() gives verifiedVenueUrl's plain string
  // the same shape as the other two candidates, so the hostname checks below
  // apply uniformly regardless of which source actually won.
  const outbound = copyVenue || buyLive || safeUrl(verifiedVenueUrl(venueName)) || null;
  const url = outbound ? String(outbound) : `https://dothebay.com${e.permalink}`;

  // Computed ONCE. The card renders this and the tags are derived from this,
  // so a tag can never be justified by a word the reader does not see.
  const desc = cleanDescription(e.excerpt || e.description, venueName);

  return {
    id: String(e.id),
    // The title MUST go through the cleaner here. `cleanTitle` was written and
    // tested against every case in the feed, but this line was never wired to
    // it — so the tests exercised the function while the shipped feed kept the
    // raw strings, and 7 listings still read "(SF)" or "(Santa Rosa)".
    title: cleanTitle(e.title),
    venue: venueName || "San Francisco",
    // NOT venue.city. That is the CITY, and putting it here made 106 of 110
    // rows read "San Francisco" — a neighborhood filter over it would offer one
    // chip and filter nothing. Derive the hood from the street address instead;
    // hoodsOf() runs over the whole set just before the write and fills this in
    // properly. Left as a placeholder here so the shape stays obvious.
    neighborhood: "San Francisco",
    address: venue?.full_address || e.venue?.full_address || null,
    // The SAME string that renders. Computing the description once and using
    // it for both the card and the tags is what makes the two impossible to
    // disagree; they used to be built from different fields (cleanDescription
    // for the card, the raw excerpt for the tags), so a tag could cite copy the
    // reader never sees.
    description: desc,
    image: eventImage(e),
    date: t.date,
    startMinutes: t.startMinutes,
    // -1 means "the source gave no end", which the renderer must not show as a
    // range. It is kept rather than dropped so the field is always present and
    // the shape of the data never depends on the source.
    endMinutes: typeof t.endMinutes === "number" ? t.endMinutes : -1,
    timeLabel: t.timeLabel,
    priceLabel: price.label,
    priceTier: price.tier,
    categories: categorize(e.category, e.title, desc, venueName),
    url,
    linkTier: linkTier(outbound, venueName),
    soldOut: soldOut(e, [e.title, e.excerpt, e.description].join(" ")),
  };
}
// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------
const out = [];
const seen = new Set();
// Second dedupe key, built from the event itself rather than the source's id.
// Two feeds routinely carry the same listing: Workshop SF's class appeared both
// as a DoTheBay row (id "17713132", with a price) and as a Tribe-feed row (id
// "wsf-98265", no price), and because ids are per-source they never collided —
// the same class was published twice, side by side. Key on normalised
// title + date + start minute, so a cross-source duplicate collapses whichever
// order the sources happen to run in.
const seenContent = new Set();
let dupesCollapsed = 0;
let droppedElsewhere = 0;
const contentKey = (n) =>
  `${n.date}|${n.startMinutes}|${(n.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;

function add(e, venue) {
  // Check the RAW title, before the cleaner strips the city suffix. "(Santa
  // Rosa)" is the only evidence the row is out of town; once cleanTitle has
  // removed it, the row is indistinguishable from its SF twin. This is why the
  // drop has to happen HERE and not downstream of normalize().
  if (isElsewhere(e.title)) {
    droppedElsewhere++;
    return;
  }
  const n = normalize(e, venue);
  if (!n) return;
  if (seen.has(n.id)) return;

  // Keep the richer row when both feeds have it. The DoTheBay copy of a class
  // carries a price and a human time span; the venue's own feed often carries
  // neither. A later row therefore upgrades the earlier one rather than being
  // dropped.
  const key = contentKey(n);
  if (seenContent.has(key)) {
    dupesCollapsed++;
    const at = out.findIndex((r) => contentKey(r) === key);
    if (at >= 0 && richer(n, out[at])) {
      out[at] = n;        // the new row supersedes the old
      seen.add(n.id);
    }
    return;
  }
  seenContent.add(key);
  seen.add(n.id);
  out.push(n);
}

// Register a row built by a hand-kept venue module. Those modules assemble the
// event object themselves, so they call this instead of pushing to `out`
// directly — pushing bypasses BOTH dedupe passes, which is how the same class
// ended up on the page twice.
function register(row) {
  if (seen.has(row.id)) return false;
  const key = contentKey(row);
  if (seenContent.has(key)) {
    dupesCollapsed++;
    const at = out.findIndex((r) => contentKey(r) === key);
    if (at >= 0 && richer(row, out[at])) {
      out[at] = row;
      seen.add(row.id);
    }
    return false;
  }
  seenContent.add(key);
  seen.add(row.id);
  out.push(row);
  return true;
}

// "Richer" is only ever consulted between two rows for the same event, so this
// compares completeness, not quality. A published price is the single most
// useful field on the card; a real end time beats a bare start.
function richer(a, b) {
  if (!b) return true;
  const score = (r) =>
    (r.priceLabel ? 4 : 0) +
    (r.endMinutes > r.startMinutes && r.startMinutes >= 0 ? 2 : 0) +
    (r.image ? 1 : 0) +
    (r.description ? 1 : 0);
  return score(a) > score(b);
}

// The two citywide feeds cover today and tomorrow across the whole Bay Area.
async function citywide() {
  for (const band of ["today", "tomorrow"]) {
    try {
      const d = await j(`https://dothebay.com/events/${band}.json?per_page=50`);
      for (const e of d.events || []) add(e, e.venue);
      console.log(`  ${band}: +${(d.events || []).length} raw`);
    } catch (err) {
      console.log(`  ${band}: ${err.message}`);
    }
  }
}

// The citywide feeds stop at tomorrow. Each venue's own calendar runs a month
// out, so walking the SF venues is what reaches day three. The venue endpoint
// returns date-grouped events, so this is one request per venue.
async function venues() {
  // The venue endpoint IGNORES per_page and always returns 25 records, so a
  // loop that stops when `batch.length < requested` quits after page 1 and
  // reads 25 of the 447 venues — silently, with no error. Day three then
  // depends on whatever the citywide feeds happen to carry. Follow the
  // advertised paging instead: total_pages / next_page_path.
  const all = new Map();
  let page = 1;
  let totalPages = Infinity;
  while (page <= totalPages && page <= 40) {
    let d;
    try {
      // Page 1 MUST be requested WITHOUT `?page=1`. The endpoint 301s that one
      // exact URL to the bare path, and the redirect body is an HTML stub, not
      // JSON — so the fetch threw, the `catch` below fired on the FIRST request
      // and `break` abandoned the whole walk. The feed went from 191 events to
      // 59 with no error anywhere, because "0 candidate venues" is the only
      // thing it printed.
      //
      // Verified against the live endpoint, not assumed: `?page=1` -> 301 (98
      // bytes, HTML); `?page=2` -> 200; `?per_page=100` -> 200 but still only
      // 25 records, so paging really is required.
      const url = page === 1
        ? "https://dothebay.com/venues.json"
        : `https://dothebay.com/venues.json?page=${page}`;
      d = await j(url);
    } catch (err) {
      // A mid-walk failure is not a reason to throw away the venues already
      // read — losing page 1 must not cost pages 2..20.
      console.log(`  venue index page ${page} failed: ${String(err).slice(0, 80)}`);
      break;
    }
    const batch = d.venues || [];
    if (!batch.length) break;
    for (const v of batch) all.set(v.permalink, v);
    totalPages = (d.paging && d.paging.total_pages) || 1;
    page++;
  }
  // The index record is a PRE-FILTER for performance, not the authority. Many
  // index records carry neither `city` nor coordinates and an address with no
  // city token ("1310 Haight St" = Workshop, "24 Willie Mays Plaza" = Oracle
  // Park), so venueInSF() cannot place them either way. Rejecting on that was
  // losing real venues; admitting on it would admit Oracle Park, which is in
  // SF but not a city venue.
  //
  // So: read the calendars of everything not positively excluded, and let the
  // EVENT'S OWN venue record — which the calendar response carries with a real
  // city — decide in add(). A Berkeley or Oakland listing is still rejected,
  // because its own record says so, and the count below reports how many of
  // the unplaced calendars turned out to matter.
  const definitelyOut = (v) => {
    if (v.city) return !SF_CITY.test(v.city.trim());
    if (v.latitude != null && v.longitude != null) return !inSF(v);
    const a = `${v.address || ""} ${v.full_address || ""}`;
    const m = /san francisco|oakland|berkeley|napa|sausalito|daly city|san jose|alameda|san mateo|palo alto|santa clara|walnut creek|marin|sonoma|san rafael|fremont|sunnyvale|santa cruz|petaluma|novato|concord|antioch|vallejo|fairfield|richmond|hayward|union city/i.exec(a);
    return m ? !SF_CITY.test(m[0]) : false; // no city named → undecided, keep
  };
  const sf = [...all.values()].filter((v) => !definitelyOut(v));
  console.log(`  ${sf.length} candidate venues of ${all.size} scanned (${totalPages} pages)`);

  const wanted = new Set(windowDays());
  const CONCURRENCY = 6;
  let fetched = 0;

  for (let i = 0; i < sf.length; i += CONCURRENCY) {
    const batch = sf.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (v) => {
        try {
          return await j(`https://dothebay.com${v.permalink}/events.json?per_page=50`);
        } catch {
          return null;
        }
      })
    );

    for (const d of results) {
      if (!d) continue;
      fetched++;
      for (const group of d.event_groups || []) {
        if (!wanted.has(group.date)) continue;
        for (const e of group.events || []) {
          // Prefer the event's OWN inline venue over the index stub. The index
          // record for a venue like Workshop carries neither `city` nor an
          // address, so venueInSF() rejects it and the whole calendar is never
          // read — the walk silently loses a venue that has in-window events.
          // The calendar response carries the real address ("1310 Haight St,
          // San Francisco"), so checking the event's own venue fixes the loss
          // without widening the box: a Berkeley or Oakland event is still
          // rejected, because its own venue record says so.
          add(e, (e && e.venue) || d.venue);
        }
      }
    }
    process.stdout.write(`\r  venues ${Math.min(i + CONCURRENCY, sf.length)}/${sf.length}`);
  }
  console.log(`\n  ${fetched} venue calendars read, ${out.length} events kept so far`);
}
// ---------------------------------------------------------------------------
// Dedupe across sources: same id, then same title+date+venue
// ---------------------------------------------------------------------------
// Two sources describing one event word it differently — "Free Art Workshop:
// 3D Paper Flowers (SF)" and "Free Art Workshop: 3D Paper Flowers" — so the
// key truncates the slug to ignore trailing qualifiers. Truncating *mid-word*
// let "(SF)" through and both rows survived, printing the same workshop twice
// at 2:00 and 2:40.
//
// The venue slug is included because two genuinely different events can share
// a title at one venue on one day (KQED LIVE runs Rick Steves twice, Santa
// Rosa and Redwood City) and collapsing those would lose a real listing.
function dedupe() {
  const byKey = new Map();
  const byUrl = new Map();
  const kept = [];
  for (const e of out) {
    const key = `${e.date}|${slug(e.title).slice(0, 34)}|${slug(e.venue)}`;
    if (byKey.has(key)) continue;
    // Same organizer URL + same day + close start time = the same listing
    // described twice. Compare on the URL rather than the title for this.
    //
    // The key must include the URL's PATH, not just its hostname. Ticket
    // engines are white-label: wl.seetickets.us, www.ticketweb.com and
    // ticketing.uswest.veezi.com each front dozens of unrelated SF venues, so
    // a hostname-only key collided every show sharing a platform inside one
    // 30-minute slot. Measured: 34 real listings destroyed that way, including
    // Tobi Lou, Chat Pile and Sophie Truax — "Chanel Beads" at Brick & Mortar
    // was discarded because an unrelated Rickshaw Stop show sat on the same
    // host in the same slot. Two sources describing one event point at the
    // same deep link, so the path is both necessary and sufficient.
    const u = safeUrl(e.url);
    const uk = `${e.date}|${u ? u.hostname + u.pathname : e.url}|${Math.round((e.startMinutes < 0 ? 0 : e.startMinutes) / 30)}`;
    if (byUrl.has(uk)) continue;
    byKey.set(key, e);
    byUrl.set(uk, e);
    kept.push(e);
  }
  return kept;
}

// The start time lives on the day's INDEX page, in the schedule block, not on
// the listing's own page — the detail page's .fc-event-start-time only ever
// appears inside its inline <style> rule, so scraping it there yields nothing
// and every row silently reads "Time TBA".
//
// The schedule is a flat run of <span class="fc-event-start-time">7:00 pm</span>
// …followed by that listing's anchor. Walk forward from each time span to the
// first listing link and pair them. `href` is protocol-relative on these pages.
function timeFor(html, url) {
  const slug = url.replace(/^https?:\/\/sf\.funcheap\.com\//, "").replace(/\/$/, "");
  for (const m of html.matchAll(/<span class="fc-event-start-time">([^<]+)<\/span>/g)) {
    const window = html.slice(m.index + m[0].length, m.index + m[0].length + 1600);
    const lm = window.match(/href="(?:https:)?\/\/sf\.funcheap\.com\/([a-z0-9][^"]*-\d+)\/"/);
    if (lm && lm[1] === slug) return m[1].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Funcheap — a second, independent source
// ---------------------------------------------------------------------------
// DoTheBay alone is one editorial calendar; "all events in the next three days"
// deserves more than one. Funcheap covers a noticeably different set (street
// fairs, neighborhood pop-ups, walk tours) and every listing carries an
// out-link to the organizer, so it satisfies the same no-aggregators rule.
//
// Two things make this non-trivial and both were learned the hard way:
//  - the RSS feed is useless here. It carries ~10 items, all of them *recurring
//    series* published weeks ahead ("11/23/26: Mirthquake"). The date pages
//    are the real listing index.
//  - Funcheap is a Bay-Area site, so the byline city has to be filtered. Left
//    unfiltered it contributes Oakland, Berkeley and Napa events to a page
//    that claims to be San Francisco.
async function funcheap(days) {
  const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
  const get = async (u) => {
    const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  };
  const text = (s) =>
    s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
     .replace(/<[^>]+>/g, " ")
     // Named entities first (they overlap: &amp; before &apos; would corrupt it)
     .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
     .replace(/&apos;/gi, "'").replace(/&mdash;/gi, "—").replace(/&ndash;/gi, "–")
     .replace(/&rsquo;/gi, "’").replace(/&lsquo;/gi, "‘")
     .replace(/&ldquo;/gi, "“").replace(/&rdquo;/gi, "”")
     .replace(/&hellip;/gi, "…").replace(/&middot;/gi, "·").replace(/&reg;/gi, "®")
     .replace(/&copy;/gi, "©").replace(/&trade;/gi, "™")
     .replace(/&#0*(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
     .replace(/&#x0*([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
     .replace(/\s+/g, " ").trim();

  // Not SF proper. Matched against the byline city, not the title.
  const OUT_OF_SF =
    /oakland|berkeley|napa|sausalito|daly city|marin|san jose|san mateo|alameda|emeryville|concord|vallejo|fairfield|stockton|san luis|monterey|santa cruz|san rafael|half moon|palo alto|redwood|fremont|hayward|richmond|antioch|martinez|san francisco bay|peninsula|east bay/i;

  // Collect listing permalinks *paired with the date of the index page they
  // were found on*. The permalink itself carries no date ("...-83/"), so the
  // date has to be attached here — reading it off the URL later returns
  // nothing and every row would land on the wrong day.
  const pages = [];
  for (const d of days) {
    const iso = d.replace(/-/g, "/");
    for (let pg = 1; pg <= 4; pg++) {
      const u = `https://sf.funcheap.com/${iso}/` + (pg > 1 ? `page/${pg}/` : "");
      let html;
      try { html = await get(u); } catch { break; }
      // Slugs start with a letter or a digit ("6-drive-in-movie-night…"), and
      // many carry an "sfs-" prefix. Anchoring on [a-z] silently dropped every
      // listing whose title began with a number.
      const found = html.match(
        /<a href="(https:\/\/sf\.funcheap\.com\/(?!venue\/|region\/|category\/|about\/|\d{4}\/)[a-z0-9][^"]*-\d+)\/"/g) || [];
      const uniq = [...new Set(found.map((m) => m.match(/href="([^"]+)"/)[1]))];
      const fresh = uniq.filter((x) => !pages.some((p) => p.u === x));
      // A recurring series can be listed on several days. Keep every day it
      // actually appears rather than collapsing to whichever page came first.
      for (const x of fresh) pages.push({ u: x, day: d, time: timeFor(html, x) });
      if (!uniq.length) break;
    }
  }
  console.log(`  funcheap: ${pages.length} candidate listings`);

  // Each listing is its own fetch. Bounded concurrency — this host is 2-core.
  const LIM = 6;
  const uniqPages = [...new Map(pages.map((p) => [p.u, p])).values()];
  for (let i = 0; i < uniqPages.length; i += LIM) {
    const batch = uniqPages.slice(i, i + LIM);
    const got = await Promise.all(batch.map(async (p) => {
      try { return { ...p, html: await get(p.u) }; } catch { return { ...p, html: null }; }
    }));

    for (const { u, day, time: day_time, html } of got) {
      if (!html) continue;

      const mv = html.match(/<a href="https:\/\/sf\.funcheap\.com\/venue\/[^"]+\/">([^<]+)<\/a>\s*\|\s*([^<]+?)</);
      if (!mv) continue;
      // Run BOTH through text(): the venue name is still HTML-escaped in the
      // markup, so reading it raw shipped "Pop&#8217;s Bar" to the page.
      const venue = text(mv[1]);
      // The city half of the "| Venue | City" block. It was `([^<]+?)</`, and
      // that character class admits newlines, so a listing whose byline block
      // lacked a closing tag ran the capture 10,256 characters down the page
      // and shipped a 10KB "city" — the whole festival write-up pasted into
      // the address line. An address is a single line: bound it to one, and
      // bound its length. Same class of bug as the time regex below.
      const city = text((mv[2].match(/[^\n]{0,80}/) || [""])[0]);
      if (OUT_OF_SF.test(city) || !/san francisco|\bSF\b|california/i.test(city)) continue;

      // The organizer link lives in an <h3 class="url event"> out-link block.
      const mu = html.match(/<h3[^>]*class="url event[^"]*"[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"/);
      // Unwrap before judging: a shortened venue link (bit.ly/…) is not an
      // aggregator, it is a redirect to one. Testing the raw host threw away
      // real venue pages.
      const organizer = mu ? unwrapTracker(mu[1]) : null;
      if (!organizer || AGGREGATOR_HOSTS.test(organizer.hostname)) continue;

      // The title is the page's <h1>. There is no "event-headline" block —
      // matching one cost every listing its title and silently dropped the lot.
      const mt = html.match(/<h1[^>]*>([\s\S]{0,160}?)<\/h1>/);
      const title = text(mt ? mt[1] : "");
      if (!title) continue;

      // Cost. The real markup is a single span — <span class="cost"> |
      // Cost: FREE</span> — not a "Cost:" label followed by a tooltip link,
      // which is what this read before, so every listing came out priceless
      // and dropped out of the price filter.
      const mc = html.match(/<span class="cost">([^<]*?Cost:\s*([^<]*?))\s*<\/span>/i);
      const cost = mc ? text(mc[2]) : null;
      const free = cost ? /\bfree\b/i.test(cost) : false;

      // Start time. The listing's own page carries the authoritative one in
      // the #stats bar ("Tuesday, September 29, 2026 - 5:00 pm to 8:00 pm"),
      // which also resolves the end time. The index pairing is the fallback
      // for listings whose page omits it. The .fc-event-start-time class is
      // only ever a <style> rule on the detail page, never a value.
      const ms = html.match(/<span style="font-weight:normal;">\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)(?:\s*to\s*([\d:]+\s*[ap]m))?/i);
      const time = day_time || (ms ? text(ms[1]) : null);
      const endTime = ms && ms[2] ? text(ms[2]) : null;
      const m12 = time && time.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
      const startMinutes = m12
        ? (parseInt(m12[1], 10) % 12) * 60 + parseInt(m12[2], 10) + (/pm/i.test(m12[3]) ? 720 : 0)
        : -1;
      // Same house rule as everywhere else: an end time becomes a range. The
      // detail page's own "5:00 pm to 8:00 pm" is the best end-time source in
      // the whole pipeline, so it is used whenever the regex finds it.
      const endMinutes = parseTimeToMinutes(endTime);
      const timeLabel = startMinutes >= 0
        ? timeRangeLabel(startMinutes, endMinutes)
        : (time || "Time TBA");

      // The day comes from the index page this listing was found on. The
      // permalink is date-free, so there is nothing to parse from it.
      const iso = day;
      if (!days.includes(iso)) continue;

      // Address. The old pattern was `\| ([^<|]*,\s*(?:San Francisco|SF)[^<|]*,
      // CA[^<|]*)` — an UNBOUNDED run that starts at a "Directions |" pipe and
      // keeps going until it finds ", CA" anywhere in the remaining document.
      // On a listing with no address in the byline block it sailed 10,256
      // characters down the page and printed the entire festival programme as
      // the street address. That is the bug behind the mangled card.
      //
      // Read it from the schema.org block instead, which is what it is FOR and
      // which is a bounded, structured value. The byline fallback is kept for
      // the listings that carry no JSON-LD, but it is now bounded to one line
      // and to a plausible address length, so a miss degrades to no address
      // rather than to a 10KB one.
      let ldAddress = null;
      for (const b of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        try {
          const j = JSON.parse(b[1]);
          const a = j?.location?.address;
          if (typeof a === "string" && a.length <= 120) { ldAddress = a; break; }
        } catch { /* not a JSON block we can read; try the next one */ }
      }
      const addrFallback = (html.match(/\| ([^<|\n]{2,120}?,\s*(?:San Francisco|SF)[^<|\n]{0,60}?,\s*CA(?:\s+\d{5})?)/i) || [])[1];
      const address = text(ldAddress || addrFallback || "");

      const blurb = text((html.match(/<div class="post-content">([\s\S]{0,600}?)<\/div>/) || [])[1] || "").slice(0, 220);
      const id = `fc-${u.match(/-(\d+)\/$/)?.[1] || Math.abs(hash(u))}-${iso}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        // Same reason as the DoTheBay normalizer: every source has to go
        // through the one cleaner, or the copies drift and a title keeps its
        // "(SF)" suffix depending on which scraper produced the row.
        title: CLEAN.cleanTitle(title),
        venue,
        neighborhood: "San Francisco",
        address: address || null,
        date: iso,
        startMinutes,
        endMinutes,
        timeLabel,
        priceLabel: free ? "Free" : (cost || null),
        priceTier: free ? "free" : (cost ? "paid" : "unknown"),
        categories: categorize(null, `${title} ${venue}`, blurb, venue),
        // Funcheap's own page is an aggregator, so it is only the last resort.
        // A venue we have verified a real site for is always better.
        url: verifiedVenueUrl(venue) || organizer.toString(),
        linkTier: verifiedVenueUrl(venue) ? "venue" : linkTier(organizer, venue),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// City Lights Booksellers
//
// A shop the brief named explicitly, and the source that proves a feed is not a
// feed. Everything else here comes from DoTheBay's JSON; City Lights is a
// WordPress calendar, and it does not appear in that JSON at all. Measured: it
// has TWO events inside the window (Sept 29 and Oct 1) and the site showed
// neither.
//
// It also cannot be fetched with `fetch()`. A plain request returns a
// Cloudflare 307 with no body, so the calendar is invisible to an HTTP client
// no matter how the headers are set — the same wall that makes a venue look
// "unavailable" when it is simply gated. Headless Chrome renders it, so this
// source pays for one browser rather than one calendar.
//
// Do not try to make `get()` reach this page. It cannot.
async function cityLights(days) {
  const VENUE = "City Lights Booksellers";
  // The browser must stay open until BOTH evaluate() calls are done. Closing it
  // in a finally around goto() — the obvious shape — leaves `page` dangling and
  // the next evaluate throws "Target page, context or browser has been closed".
  // The try/finally here wraps the whole read, not just the navigation.
  let browser = null;
  let page = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    page = await browser.newPage();
    await page.goto("https://citylights.com/events/", { waitUntil: "domcontentloaded", timeout: 45000 });

  // Read the calendar out of the rendered DOM in one pass. The page is a flat
  // sequence of "date line, time, title, blurb, type, View Details", so the
  // listing blocks are cut on the date lines and each block is then read.
  //
  // NB: the local collection is named `raw`, not `out`. The module already has
  // an `out` (the kept-events array this function pushes into), and shadowing
  // it inside the evaluate callback would read as a bug and break silently if
  // the callback were ever inlined.
  const blocks = await page.evaluate(() => {
    const DATE = /(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,?\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}),?\s*(\d{1,2}:\d{2}\s*[ap]m)\s*(?:[A-Z]{2,4})?/gi;
    const t = document.body.innerText.replace(/ /g, " ");
    const raw = [];
    const rx = new RegExp(DATE.source, "gi");
    let m;
    while ((m = rx.exec(t))) {
      const start = m.index;
      const next = t.indexOf("View Details", start);
      raw.push({
        dateText: m[1],
        time: m[2],
        text: t.slice(start, next > 0 ? next + "View Details".length : start + 600),
      });
    }
    return raw;
  });

  const anchorOrder = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/events/"]'))
      .map((a) => (a.getAttribute("href") || "").trim())
      .filter((h) => h && h !== "/events/")
      .filter((v, i, arr) => arr.indexOf(v) === i)
  );

  const MONTH = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
  let added = 0;
  for (const b of blocks) {
    const dm = b.dateText.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
    if (!dm) continue;
    const mo = MONTH[dm[1].toLowerCase()];
    if (mo == null) continue;
    const iso = `${dm[3]}-${String(mo + 1).padStart(2, "0")}-${String(dm[2]).padStart(2, "0")}`;
    if (!days.includes(iso)) continue;

    // The block text runs date line -> time -> title -> blurb -> type.
    const lines = b.text.split("\n").map((s) => s.trim()).filter(Boolean);
    const dateLine = lines[0] || "";
    const title = (lines[1] || "").replace(dateLine, "").trim() || (lines[2] || "");
    const blurb = (lines[2] || "").replace(dateLine, "").trim();
    if (!title || /^view details$/i.test(title)) continue;
    if (/event passed/i.test(dateLine)) continue;

    // Order the permalinks by the slug the listing itself names, so the right
    // URL lands on the right event rather than by position in a list.
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    let url = null;
    const exact = anchorOrder.find((h) => h === `https://citylights.com/events/${slug}/`);
    if (exact) url = exact;
    if (!url) {
      const words = title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
      const cand = anchorOrder.find((h) => words.filter((w) => h.includes(w)).length >= Math.max(1, words.length - 1));
      if (cand) url = cand;
    }
    if (!url) continue;

    const m12 = String(b.time || "").match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    const startMinutes = m12
      ? (parseInt(m12[1], 10) % 12) * 60 + parseInt(m12[2], 10) + (/pm/i.test(m12[3]) ? 720 : 0)
      : -1;
    // The block's time field can be a single time or already read as a range
    // ("7:00 pm to 9:00 pm"). Take the LAST time on the line as the end, so a
    // range survives instead of being collapsed to its first half.
    const allTimes = String(b.time || "").match(/\d{1,2}:\d{2}\s*(?:am|pm)/gi) || [];
    const endMinutes = allTimes.length > 1
      ? parseTimeToMinutes(allTimes[allTimes.length - 1])
      : -1;
    const timeLabel = startMinutes >= 0
      ? timeRangeLabel(startMinutes, endMinutes)
      : (b.time || "Time TBA");
    const cost = /\bfree\b/i.test(b.text) ? "Free" : null;

    const id = `cl-${slug}-${iso}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title,
      venue: VENUE,
      neighborhood: "North Beach",
      address: "261 Columbus Ave, San Francisco, CA 94133",
      description: blurb.slice(0, 220),
      date: iso,
      startMinutes,
      endMinutes,
      timeLabel,
      priceLabel: cost,
      // Was `cost ? "free" : "unknown"`, which is inverted: a KNOWN free
      // event was tagged "free" only by accident (cost is "Free" or null, and
      // the free row happened to exist), while a paid City Lights listing would
      // have been tagged "free". Correct: a known cost means we know the tier.
      priceTier: cost === "Free" ? "free" : (cost ? "paid" : "unknown"),
      categories: categorize(null, `${title} ${VENUE}`, blurb, VENUE),
      // City Lights' own event page IS the organiser page for a City Lights
      // event, so this is a first-party link, not an aggregator fallback.
      url,
      linkTier: "venue",
    });
    added++;
  }
  console.log(`  city lights: ${added} in-window listings (${blocks.length} on the calendar)`);
  } catch (e) {
    // One source failing must not take the whole build down. A missing browser
    // or a Cloudflare change costs City Lights' listings and nothing else.
    console.log(`  city lights: unavailable (${String(e.message).split("\n")[0]}) — skipped`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Omnivore Books on Food
//
// The second bookshop the brief named, and a different shape again from City
// Lights: a Shopify store, not a WordPress calendar. Its event list lives at
// /collections/upcoming-events and the collection page carries NO dates at
// all — each event's date is on its own product page, in an all-caps line
// ("TUESDAY, SEPTEMBER 29 AT 6:30 PM") with no year.
//
// Two consequences worth keeping:
//   * The date regex must match that exact shape. A mixed-case, year-bearing
//     pattern silently matches nothing and reports "0 events in window",
//     which is indistinguishable from a genuinely empty calendar.
//   * The year is inferred from the window rather than parsed.
//   * `omnivorebooks.com` 302s to `omnivorebooks.myshopify.com`, so the
//     myshopify host IS the canonical one. Keep it; do not "tidy" it back.
//
// A "*OFF-SITE*" listing is a real SF event that happens somewhere other than
// the shop (Reem's Mission, for one). It is kept, but filed under the venue
// named on the page instead of the shop's own address, which would otherwise
// send a reader to the wrong building.
async function omnivore(days) {
  const SHOP = "Omnivore Books on Food";
  let browser = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.goto("https://omnivorebooks.myshopify.com/collections/upcoming-events", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    const listings = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href*="/products/"]'))
        .map((a) => ({ title: a.textContent.replace(/\s+/g, " ").trim(), href: a.href }))
        .filter((x) => x.title.length > 8 && !/gift card|cookbook club/i.test(x.title))
        .filter((v, i, arr) => arr.findIndex((z) => z.href === v.href) === i)
    );

    const MONTH = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
    const year = days[0].slice(0, 4);
    let added = 0;

    for (const ev of listings) {
      let d;
      try {
        await page.goto(ev.href, { waitUntil: "domcontentloaded", timeout: 30000 });
        d = await page.evaluate(() => {
          const t = document.body.innerText.replace(/\s+/g, " ");
          // The listing prints "THURSDAY, SEPTEMBER 24 AT 7:00 PM" and, when the
          // organizer gives one, either "7:00 PM - 9:00 PM" or "7:00 PM to
          // 9:00 PM". Capturing the optional tail is what lets the row render
          // as a range instead of silently dropping the end.
          const m = t.match(
            /\b((?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),\s*(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+\d{1,2})\s+AT\s+(\d{1,2}(?::\d{2})?\s*[AP]M)(?:\s*(?:-|–|—|to|until|til)\s*(\d{1,2}(?::\d{2})?\s*[AP]M))?/i
          );
          return {
            date: m ? m[1] : null,
            time: m ? m[2] : null,
            endTime: m && m[3] ? m[3] : null,
            offSite: /off-?site/i.test(document.body.innerText),
            free: /event is free|free to attend|free event/i.test(document.body.innerText),
            venueHint: (t.match(/at (Reem'?s[^,.]*)/i) || [])[1] || null,
            blurb: (t.match(/ABOUT THE AUTHOR[\s\S]{0,300}/i) || [])[0] || "",
          };
        });
      } catch {
        continue; // one unreachable event page must not stop the walk
      }
      if (!d.date) continue;

      const dm = d.date.match(/([A-Za-z]+),?\s*(\d{1,2})$/);
      const mm = dm && MONTH[dm[1].trim().toLowerCase()];
      if (mm == null) continue;
      const iso = `${year}-${String(mm + 1).padStart(2, "0")}-${String(dm[2]).padStart(2, "0")}`;
      if (!days.includes(iso)) continue;

      const blurb = d.blurb.replace(/ABOUT THE AUTHOR\s*/i, "").slice(0, 220);
      const title = ev.title.replace(/^\*OFF-SITE\*\s*/i, "").trim();
      const offSite = /^\*OFF-SITE\*/i.test(ev.title);
      const m12 = String(d.time || "").match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
      const startMinutes = m12
        ? (parseInt(m12[1], 10) % 12) * 60 + parseInt(m12[2], 10) + (/pm/i.test(m12[3]) ? 720 : 0)
        : -1;
      // An end time on the listing becomes a range, same as every other source.
      const endMinutes = parseTimeToMinutes(d.endTime);
      const timeLabel = startMinutes >= 0
        ? timeRangeLabel(startMinutes, endMinutes)
        : (d.time || "Time TBA");
      const slug = ev.href.split("/products/")[1] || title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const id = `omni-${slug.slice(0, 40)}-${iso}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        title: CLEAN.cleanTitle(title),
        // An off-site event is not at the bookshop; do not send the reader to
        // the shop's door with a ticket for someone else's evening.
        venue: offSite && d.venueHint ? d.venueHint : SHOP,
        // Both the shop and Reem's are on Mission Street, so the neighborhood
        // is the same either way — but saying so once is honest, whereas the
        // ternary this replaced had two identical arms and read as a decision.
        neighborhood: "Mission",
        address: offSite && d.venueHint
          ? "Reem's Mission, 2801 23rd St, San Francisco, CA 94110"
          : "3198 Mission St, San Francisco, CA 94110",
        description: blurb,
        date: iso,
        startMinutes,
        endMinutes,
        timeLabel,
        priceLabel: d.free ? "Free" : null,
        priceTier: d.free ? "free" : "unknown",
        categories: categorize(null, `${title} ${SHOP}`, blurb, SHOP),
        url: ev.href,
        linkTier: "venue",
      });
      added++;
    }
    console.log(`  omnivore: ${added} in-window events (${listings.length} listed)`);
  } catch (e) {
    console.log(`  omnivore: unavailable (${String(e.message).split("\n")[0]}) — skipped`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const days = windowDays();
  console.log(`SF Pink Pages — ${days[0]} through ${days[days.length - 1]}`);

  await citywide();
  await venues();
  await funcheap(days);
  await cityLights(days);
  await omnivore(days);

  // Hand-kept venues from the brief. Each is a different stack, so each has
  // its own source rather than a generic extractor pretending to cover them.
  await centerForTheBook(days);
  await workshopSF(days);
  await clayroom(days);
  await scrap(days);

  // A row whose TITLE says it is not happening is not a listing. Sources
  // publish these by prepending to the title ("CANCELLED Sofar Sounds —
  // Concord") and the event itself stays in the feed with a future date, so
  // nothing else in the pipeline drops it. The `private|buyout|closed for`
  // test lives inside the DoTheBay normalizer and therefore only ever sees
  // DoTheBay rows — funcheap, City Lights and the hand-kept venue modules all
  // push straight to `out` and bypass it. This is the one place every row
  // passes through, which is what makes it a filter and not another
  // source-specific patch.
  //
  // Anchored on a word boundary and matched against the whole title, so it
  // catches "Cancelled:", "CANCELLED ", "Show Cancelled" and "Event canceled"
  // while leaving alone a legitimately-named show that merely contains the
  // letters — "The Canceled wedding" is a real production, and a bare
  // substring test would hide it.
  // Cancellation is a SHARED rule — shared.mjs owns it, and dc-fetch.mjs calls
  // isCancelledTitle() there. This used to re-declare its own copy of the regex,
  // which is the same duplication that let DC ship emoji SF did not: two
  // correct-today copies that can drift tomorrow. One definition now.
  const survivors = [];
  let cancelledCount = 0;
  for (const e of dedupe().filter((r) => days.includes(r.date))) {
    if (isCancelledTitle(e.title)) { cancelledCount++; continue; }
    survivors.push(e);
  }
  const events = survivors
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || a.venue.localeCompare(b.venue));

  // Neighborhoods are derived HERE, not at collection time, because the hood
  // map is a whole-corpus concern: the same ZIP can read differently once you
  // see what else is on that block, and the fallback is "the value already on
  // the row", which is only known once every row exists. Runs after the sort so
  // the counts below describe exactly what is published.
  const hoods = hoodsOf(events);
  const generic = hoods.filter((h) => h.hood === "San Francisco").reduce((s, h) => s + h.n, 0);
  console.log(`  neighborhoods: ${hoods.length} (${events.length - generic}/${events.length} resolved to a specific hood)`);

  const payload = {
    generatedAt: new Date().toISOString(),
    days,
    counts: {
      total: events.length,
      free: events.filter((e) => e.priceTier === "free").length,
      // "Direct" means the venue's own site. A box-office link is a separate,
      // smaller number, and the remainder fall back to the aggregator's page.
      directLinks: events.filter((e) => e.linkTier === "venue").length,
      boxOfficeLinks: events.filter((e) => e.linkTier === "boxoffice").length,
      aggregatorLinks: events.filter((e) => e.linkTier === "listing").length,
    },
    // The page builds its neighborhood chips from this rather than recounting
    // client-side. One tally, computed once over the exact set that is
    // published — a second tally in the browser can only drift from it.
    neighborhoods: hoods.map((h) => ({ name: h.hood, count: h.n })),
    events,
  };

  await writeFile(OUT, JSON.stringify(payload, null, 2));
  const c = payload.counts;
  console.log(`\nWrote ${events.length} events to events.json`);
  console.log(`  free: ${c.free}`);
  console.log(`  with an image: ${events.filter((e) => e.image).length}`);
  // Printed because a cancellation filter that starts eating real listings is
  // otherwise invisible — the count only goes down, which looks like success.
  console.log(`  cancelled/postponed titles hidden: ${cancelledCount}`);
  console.log(`  dropped, titled for another city: ${droppedElsewhere}`);
  // Printed because a dedupe that starts eating DISTINCT events is otherwise
  // invisible: the count only ever goes down, which looks like success.
  console.log(`  cross-source duplicates collapsed: ${dupesCollapsed}`);
  console.log(`  venue sites: ${c.directLinks}  box office: ${c.boxOfficeLinks}  aggregator fallback: ${c.aggregatorLinks}`);
  // Last line of the run: anything that failed to fetch. A source returning
  // null silently is how a broken venue index produced a clean-looking log and
  // a feed 130 events short, so a non-empty report means the counts above are
  // not trustworthy as a health signal.
  const fails = fetchFailureReport();
  if (fails) console.log(fails);
  else console.log(`  every source fetch succeeded`);
}

main().catch((e) => { console.error(e); process.exit(1); });