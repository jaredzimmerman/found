// Three hand-kept venues from the brief, plus one the brief did not name.
// Each is a different stack, and each has a different honest source. Measured
// against the live pages on 2026-09-29.
//
// ---------------------------------------------------------------------------
// 1. SAN FRANCISCO CENTER FOR THE BOOK — Squarespace 7
//
// I had recorded this venue as a "Coming Soon" parking page and closed it. That
// was wrong: the parking page is a different template, and /events is a real
// collection of `summary-item-record-type-event` entries, each with its own
// /calendar/<slug> page. One in-window event.
//
// The two traps, both of which produce a silently empty result:
//
//   * `data-upcoming-event-end` is a MILLISECOND epoch. Dividing by 1000 is
//     mandatory; treating it as seconds puts every event in 1970 and out of
//     the window, which looks identical to "no events".
//   * Do NOT try to match the item's markup with a regex that balances <div>.
//     Squarespace's nesting depth is not constant, so a `</div></div>` tail
//     matches nothing and reports zero items. Split the document on the item
//     start marker instead and let each chunk run to the next marker.
//
// The month/day badge is the fallback for any item missing the epoch attr.
//
// ---------------------------------------------------------------------------
// 2. WORKSHOP SF — The Events Calendar (Tribe) on WordPress
//
// 94 events, and the venue the brief called "Workshop SF" is workshopsf.org —
// not "Workshop" in the listings index, which is a different (and wrong) venue.
// Its calendar is a month grid, but `wp-json/tribe/events/v1/events` returns
// the same data as structured JSON, which is strictly better than scraping the
// grid: real ISO datetimes, real per-event URLs, no date parsing at all.
//
// ---------------------------------------------------------------------------
// 3. CLAYROOM SF — a course-selling site (Squarespace + third-party cart)
//
// No Tribe feed, no obvious JSON. The one-time classes page lists every class
// with its own detail page. Extracted from the listing's own anchors so each
// row links to the class page, not to the index.
//
// A note on what this file is for: three hand-added venues is not a
// generalisable scraper, and pretending otherwise is how the last pass ended
// up claiming a venue was empty when it simply had not been read. Every claim
// here was checked against the live page, and the `verified` comments record
// what was actually observed rather than what was expected.

// ---------------------------------------------------------------------------
// Two venues named in the brief that I could NOT honestly populate. Both were
// checked against the live site; neither failure is a scraper bug.
//
// 4. CLAYROOM SF — no scrapable dated listing
//
//    The site is Wix (`wix-thunderbolt`, viewer model ~538KB) and the class
//    grid is client-rendered. `pages.parastorage.com` returns 403 for the page
//    JSON, so there is no static source to parse.
//
//    I checked BOTH the page named in the brief
//    (/san-francisco-one-time-classes) and /potrero-hill-classes in a real
//    browser. Neither renders a dated class list:
//      · the 24 weekday-matching elements on /potrero-hill-classes are all the
//        store's opening hours ("Monday & Wednesday 10am-6pm"), not class dates
//      · visible text is navigation only — "Our selection of beginner to
//        advanced pottery classes" is a heading with no list under it
//
//    A weekly recurring class with no published date cannot be placed in a
//    3-day window without inventing a date. So: nothing is emitted. Writing
//    a plausible-looking row here would be worse than an absent one.
//
// 5. SAN FRANCISCO FLOWER MARKET — genuinely has no events
//
//    The brief named it. The real domain is sfflowermarket.org; sffm.com and
//    sf.flowers do not resolve or time out.
//
//    https://www.sfflower.org/events renders "We're sorry, but no events
//    matched your search." with no dated entries in the markup (the only ISO
//    date in the page is 2017-07-17, a copyright artefact). The market is
//    open to the public Wed-Sat 08:00, which is a recurring schedule, not a
//    three-day event.
//
//    Nothing to emit. Verified 2026-09-29.
//
// These are recorded here rather than left as a silent gap so the next pass
// does not re-derive them, and so "absent" means "checked and genuinely
// empty" rather than "not looked at".

// These are all provided by fetch.mjs, which is the single owner of the fetch
// helpers, the dedupe set and the output array. Importing them from a separate
// module would give a second copy of `seen`/`out` that fetch.mjs never sees, and
// every row would be published twice.
import { text, jSafe, tSafe, MONTHS, parseTimeToMinutes, decodeEntities, register } from "./fetch.mjs";

// Tribe's REST v1 returns `title` and `excerpt` as PLAIN STRINGS; the WP REST
// convention is `{rendered: "..."}`. Reading only `.rendered` yields `undefined`
// here, `if (!title) continue` drops every event, and Workshop SF published 0
// while its feed held 3 in-window — with no error logged anywhere. Accept both
// shapes, and never let a missing title become a silent drop: a venue that
// suddenly reports 0 is a scraper fault until proven otherwise, so the count
// and the reason are both printed.
const field = (v) =>
  v == null ? "" : typeof v === "string" ? v : (v.rendered ?? v.raw ?? "");
const plain = (v) =>
  decodeEntities(field(v))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const WINDOW_SFCB = new Set(["2026-09-29", "2026-09-30", "2026-10-01"]);

// ---------------------------------------------------------------- SFCB
async function centerForTheBook(days) {
  const VENUE = "Center for the Book";
  const html = await tSafe("https://www.sfcb.org/events");
  if (!html) return console.log("  sfcb: page unavailable — skipped");

  // Split on the item marker; each chunk runs to the next one. See the note
  // above: this is the only shape that survives Squarespace's variable nesting.
  const starts = [];
  const re = /summary-item-record-type-event/g;
  let m;
  while ((m = re.exec(html))) starts.push(m.index);
  if (!starts.length) return console.log("  sfcb: 0 items found — the page changed shape");

  let added = 0;
  for (let i = 0; i < starts.length; i++) {
    const blk = html.slice(Math.max(0, starts[i] - 500), starts[i + 1] || html.length);
    const href = (blk.match(/href="(\/calendar\/[^"]+)"/) || [])[1];
    const title = (blk.match(/data-title="([^"]*)"/) || [])[1];
    if (!href || !title) continue;

    // Millisecond epoch. /1000 is not optional.
    const endMs = (blk.match(/data-upcoming-event-end="(\d+)"/) || [])[1];
    let iso = endMs
      ? new Date(Number(endMs)).toISOString().slice(0, 10)
      : null;

    // Fallback: the month/day badge, with the year taken from the window.
    if (!iso) {
      const mon = (blk.match(/summary-thumbnail-event-date-month[^>]*>\s*([A-Za-z]{3,9})/) || [])[1];
      const day = (blk.match(/summary-thumbnail-event-date-day[^>]*>\s*(\d{1,2})/) || [])[1];
      const mi = mon ? MONTHS[mon.trim().slice(0, 3).toLowerCase()] : null;
      if (mi != null && day) iso = `${days[0].slice(0, 4)}-${String(mi + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    if (!iso || !days.includes(iso)) continue;

    const id = `sfcb-${href.split("/").pop()}-${iso}`;
    const kept = register({
      id,
      title: title.replace(/&amp;/g, "&").trim(),
      venue: VENUE,
      neighborhood: "San Francisco",
      address: "375 Rhode Island St, San Francisco, CA 94103",
      description: "",
      date: iso,
      startMinutes: -1,
      timeLabel: "Time TBA",
      priceLabel: null,
      priceTier: "unknown",
      categories: ["Talks & Workshops"],
      url: `https://www.sfcb.org${href}`,
      linkTier: "venue",
    });
    if (kept) added++;
  }
  console.log(`  sfcb: ${added} in-window events (${starts.length} items on the page)`);
}

// ---------------------------------------------------------------- Workshop SF
async function workshopSF(days) {
  const VENUE = "Workshop SF";
  // Tribe REST returns ISO datetimes directly. Asking for the whole set and
  // filtering locally avoids the "the API ignored my date filter" trap that the
  // listings endpoint has.
  const data = await jSafe(
    "https://workshopsf.org/wp-json/tribe/events/v1/events?per_page=50"
  );
  const all = Array.isArray(data?.events) ? data.events : [];
  if (!all.length) return console.log("  workshop sf: feed empty or changed — skipped");

  let added = 0;
  let noTitle = 0;
  for (const e of all) {
    const iso = (e.start_date || "").slice(0, 10);
    if (!days.includes(iso)) continue;
    const title = plain(e.title);
    if (!title) {
      noTitle++;
      continue;
    }
    // "Sold out" as a title prefix is a real state, not a separate listing.
    const soldOut = /\bsold out\b/i.test(title);

    const id = `wsf-${e.id}-${iso}`;
    const t = e.start_date.slice(11, 16);
    const kept = register({
      id,
      title,
      venue: VENUE,
      neighborhood: "San Francisco",
      address: "1310 Haight St, San Francisco, CA 94115",
      description: plain(e.excerpt).slice(0, 200),
      date: iso,
      startMinutes: parseTimeToMinutes(t),
      timeLabel: t,
      priceLabel: null,
      priceTier: "unknown",
      categories: ["Talks & Workshops"],
      url: e.url,
      linkTier: "venue",
      soldOut,
    });
    if (kept) added++;
  }
  console.log(`  workshop sf: ${added} in-window events (${all.length} in the feed, ${noTitle} dropped for an unreadable title${noTitle ? " — the feed changed shape" : ""})`);
}

// ---------------------------------------------------------------- Clayroom
//
// The listing page (san-francisco-one-time-classes) carries class names and
// prices but no dates, so the old parser matched zero rows there and logged
// "0 classes listed" — a real bug, not a source outage. The schedule lives on
// each class page, and it IS present in the static HTML (verified: the line
// "Saturday & Sunday, October 24-25 | 11am-5pm" appears in the raw response),
// so no headless browser is needed.
//
// A class page can carry several schedules:
//   - 6-week course: "Intro to Clay Thursday @6 pm from October 15th-November 20th"
//     -> a course, not a single event; expand to weekly sessions
//   - workshop: "Saturday & Sunday, October 24-25 | 11am-5pm" -> two events
//   - "Wednesday October 21st: 11am-5pm"                       -> one event
//   - "Saturday, November 7 & Sunday, November 8 from 10:30am"  -> two events
//
// The index also lists Oakland and San Mateo classes; those must never reach the
// SF feed, so only SF hosts are accepted.

const CLAY_SF_HOSTS = /clayroomsf\.com|clayroomsoma\.com/i;

// The studio address is published in Wix's own structured data, which is far
// more reliable than a hand-kept table of street numbers: the course pages say
// only "This class is held at our Potrero Hill Studio" with no address at all,
// while businessLocationFormatted carries the real one. Prefer that, and fall
// back to the visible address element, and only then to the studio defaults.
const CLAY_DEFAULT_ADDRESS = {
  "clayroomsf.com": "1431 17th St, San Francisco, CA 94107",
  "www.clayroomsf.com": "1431 17th St, San Francisco, CA 94107",
  "clayroomsoma.com": "727 9th St, San Francisco, CA 94103",
  "www.clayroomsoma.com": "727 9th St, San Francisco, CA 94103",
};

function clayAddress(page, url) {
  const structured =
    page.match(/"businessLocationFormatted"\s*:\s*"([^"]+)"/i)
    || page.match(/"businessLocationAddress"\s*:\s*"([^"]+)"/i);
  if (structured) {
    const a = decodeEntities(structured[1])
      .replace(/\s*,?\s*USA\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (/\d+\s+\S+\s+(st|street|ave|avenue|rd|road|drive|blvd)/i.test(a)) return a;
  }
  const visible = page.match(/<p[^>]*data-hook="location-address"[^>]*>([\s\S]{0,160}?)<\/p>/i);
  if (visible) {
    const a = decodeEntities(visible[1].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .replace(/\s*,?\s*USA\s*$/i, "")
      .trim();
    if (/\d+\s+\S+\s+(st|street|ave|avenue|rd|road|drive|blvd)/i.test(a)) return a;
  }
  const host = (url.match(/^https?:\/\/([^/]+)/i) || [])[1];
  return CLAY_DEFAULT_ADDRESS[host] || null;
}

const CLAY_DOW = "Mon|Tue|Wed|Thu|Fri|Sat|Sun";
const CLAY_MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";
const CLAY_MONTH_ABBR = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

function clayTitle(page) {
  const t = page.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
    || page.match(/<title[^>]*>([^<]+)<\/title>/i);
  return t ? t[1].replace(/\s*\|\s*clayrooms?f?\w*$/i, "").replace(/\s+/g, " ").trim() : "";
}

// The schedule is NOT in the rendered body markup — Wix keeps the page's own
// summary in <meta name="description">, which is static HTML and carries the
// schedule, the venue line and the blurb separated by blank lines. Reading the
// body instead yields one whitespace-collapsed line with no line breaks, so
// every schedule line fails the length/shape check and the source returns
// nothing. Read the meta description and fall back to the body.
function clayPageText(page) {
  const m = page.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i);
  const meta = m
    ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    : "";
  const body = decodeEntities(page)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n");
  return [meta, body].filter(Boolean).join("\n\n");
}

// A published date, normalised to {iso, label, end}.
function clayDate(day, month, timeLabel, endLabel) {
  const mi = MONTHS[(month || "").slice(0, 3).toLowerCase()];
  if (mi == null) return null;
  const d = parseInt(day, 10);
  if (!(d >= 1 && d <= 31)) return null;
  const iso = `${new Date().getFullYear()}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { iso, label: timeLabel || "Time TBA", end: endLabel || "" };
}

// A time range must carry a meridiem somewhere in the pair, otherwise the
// pattern happily matches the "24-25" inside the DATE "October 24-25" and
// reports no time at all. Scan for the first candidate that actually has one.
const CLAY_TIME = /(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)?/gi;
function clayClock(ln) {
  CLAY_TIME.lastIndex = 0;
  let m;
  while ((m = CLAY_TIME.exec(ln))) {
    // The site mixes case freely: "6-8:30PM", "6pm-8:30pm", "11AM".
    const mer = (m[2] || m[4] || "").toLowerCase();
    if (!mer) continue;
    // Both figures share one meridiem when only the second carries it:
    // "6-8:30PM" means 6pm-8:30pm, not 6am.
    return { start: `${m[1]}${mer}`, range: `${m[1]}${mer}-${m[3]}${(m[4] || mer).toLowerCase()}` };
  }
  return { start: "", range: "" };
}

// The course lines vary more than any other shape on the site. Observed:
//   "Intro to Clay Thursday @6 pm from October 15th-November 20th"
//   "Tuesdays @6-8:30PM beginning October 13th-November 17th"
//   "Mondays from 6pm-8:30pm; October 12th-November 16th"
//   "Beginning Thursday @6-8:30pm from October 14th-November 18th"
//   "Tuesday's @6-8:30PM, October 13th-November 16th"
// What all five share is the RANGE, so that is the anchor; the weekday and the
// clock time are pulled out opportunistically. Anchoring on the weekday instead
// missed four of the five.
const CLAY_RANGE = new RegExp(
  `\\b(${CLAY_MONTH})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|—|to)\\s*` +
  `(?:(${CLAY_MONTH})[a-z]*\\s+)?(\\d{1,2})(?:st|nd|rd|th)?`, "i");

// Pull schedule rows off a class page's visible text. Tolerant on purpose: the
// site mixes forms freely, so each shape gets its own rule and anything
// unrecognised is skipped rather than guessed at.
function claySchedules(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const ln = raw.replace(/\s+/g, " ").trim();
    // A schedule line states a date the way the site does: a Month D - Month D
    // range, an ampersand pair, or a weekday-anchored date that is then GIVEN A
    // CLOCK or a second weekday. "We meet on Saturday, October 3rd for the
    // "show." has the weekday and the date but neither, so it is prose.
        // Long lines are body copy however many dates they mention.
    if (!ln || ln.length > 170) continue;
    const statesDate =
      CLAY_RANGE.test(ln)
      || new RegExp(`\\b(?:${CLAY_MONTH_ABBR})[a-z]*\\s+\\d{1,2}(?:st|nd|rd|th)?\\s*&\\s*\\d{1,2}`, "i").test(ln)
      || (new RegExp(`\\b(${CLAY_DOW})[a-z]*,?\\s+(?:${CLAY_MONTH_ABBR})[a-z]*\\s+\\d{1,2}`, "i").test(ln)
          && (/\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(ln) || new RegExp(`&\\s*(${CLAY_DOW})`, "i").test(ln)));
    if (!statesDate) continue;
    const { start: startTm, range } = clayClock(ln);
    // The weekday is optional: "Beginning Thursday @6-8:30pm from ..." has one,
    // "Mondays from 6pm-8:30pm; October 12th-..." has one, and a plain
    // "October 24 & 25 with ..." has none.
    const dow = (ln.match(new RegExp(`\\b(${CLAY_DOW})`, "i")) || [])[1] || "";
    // "@6-8:30PM" also states a single start time with no range; catch that too.
    const at = (ln.match(/@\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)/i) || []);
    const clock = startTm || (at[1] ? `${at[1]}${at[2]}` : "");

    // A COURSE: a Month D - Month D range. The sessions are weekly, so they are
    // walked as real dates — stepping the day of the month would break across a
    // boundary (Oct 29 + 7 = 36).
    const rng = ln.match(CLAY_RANGE);
    if (rng) {
      const first = clayDate(rng[2], rng[1], clock || "Time TBA", "");
      const last = clayDate(rng[4], rng[3] || rng[1], "", "");
      if (first && last && last.iso >= first.iso) {
        // A range of a few days is a one-off, not a course: only walk weekly.
        const days = Math.round((new Date(`${last.iso}T12:00:00`) - new Date(`${first.iso}T12:00:00`)) / 864e5);
        if (days > 13) {
          for (let d = new Date(`${first.iso}T12:00:00`), stop = new Date(`${last.iso}T12:00:00`);
               d <= stop && out.length < 12; d.setDate(d.getDate() + 7)) {
            out.push({ iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
                       label: clock || "Time TBA", end: "" });
          }
          continue;
        }
        // Both days of a one-off share the line's clock, so carry the label
        // across the first and second pushes instead of re-deriving it.
        const oneOff = (rec) => (rec ? { ...rec, label: rec.label !== "Time TBA" ? rec.label : (clock || "Time TBA"), end: range } : rec);
        out.push(oneOff(first));
        if (last.iso !== first.iso) out.push(oneOff(last));
        continue;
      }
    }

    // "Saturday & Sunday, October 24-25 | 11am-5pm"
    let m = ln.match(new RegExp(
      `\\b(${CLAY_DOW})[a-z]*\\s*(?:&|,|and)\\s*(${CLAY_DOW})[a-z]*,?\\s+(${CLAY_MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*-\\s*(\\d{1,2})`, "i"));
    if (m) {
      const a = clayDate(m[4], m[3], startTm || "Time TBA", range);
      const b = clayDate(m[5], m[3], startTm || "Time TBA", range);
      if (a && b) { out.push(a, b); continue; }
    }

    // "Wednesday October 21st: 11am-5pm" and
    // "Saturday, November 7 & Sunday, November 8 from 10:30am - 2:30pm"
    m = ln.match(new RegExp(
      `\\b(${CLAY_DOW})[a-z]*,?\\s+(${CLAY_MONTH_ABBR})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?` +
      `(?:\\s*(?:,|&|and|-|–|from)\\s*(?:(${CLAY_DOW})[a-z]*,?\\s+)?(${CLAY_MONTH_ABBR})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?)?` +
      `(?:\\s*(?::|from)\\s*(\\d{1,2}:\\d{2}\\s*(?:am|pm)))?`, "i"));
    if (m) {
      const a = clayDate(m[3], m[2], startTm || m[7] || "Time TBA", range);
      if (a) {
        out.push(a);
        if (m[4] && m[6]) {
          const b = clayDate(m[6], m[5], startTm || m[7] || "Time TBA", range);
          if (b) out.push(b);
        }
        continue;
      }
    }

    // Bare "October 24 & 25 with Justin Paik-Reese" / "Oct 21 & 22"
    m = ln.match(new RegExp(`\\b(${CLAY_MONTH_ABBR})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*&\\s*(\\d{1,2})`, "i"));
    if (m) {
      const a = clayDate(m[2], m[1], "Time TBA", range);
      const b = clayDate(m[3], m[1], "Time TBA", range);
      if (a && b) { out.push(a, b); continue; }
    }
  }
  // A class page states the same schedule twice — once in the meta description
  // and once in the body — so a naive parse emitted every session twice and the
  // 3-day window filled with duplicate rows. Collapse on the date, preferring
  // whichever copy carries a clock: the two passes can differ there ("11am"
  // from the meta, "Time TBA" from the body) and emitting both is still a dup.
  const byDate = new Map();
  for (const r of out) {
    const prev = byDate.get(r.iso);
    if (!prev) { byDate.set(r.iso, r); continue; }
    if (prev.label === "Time TBA" && r.label !== "Time TBA") byDate.set(r.iso, r);
  }
  return [...byDate.values()].sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
}

async function clayroom(days) {
  const VENUE = "Clayroom SF";
  const html = await tSafe("https://www.clayroomsf.com/workshop");
  if (!html) return console.log("  clayroom: page unavailable — skipped");

  // Class links from the index. Wix appends ?referral=... / ?category=... to
  // each; drop the query so the published url is the clean class page.
  const hrefs = new Set();
  for (const m of html.matchAll(/href="(https?:\/\/[^"]*\/service-page\/[^"]+)"/g)) hrefs.add(m[1].split("?")[0]);
  // The Potrero Hill page carries this studio's own 6-week courses, whose cards
  // have no dates but whose class pages do.
  const ph = await tSafe("https://www.clayroomsf.com/potrero-hill-classes");
  if (ph) for (const m of ph.matchAll(/href="(https?:\/\/[^"]*\/service-page\/[^"]+)"/g)) hrefs.add(m[1].split("?")[0]);

  if (!hrefs.size) {
    return console.log(
      "  clayroom: no class links on the index — the site layout changed, so this source contributed nothing");
  }

  const year = days[0].slice(0, 4);
  const seen = new Set();
  let added = 0, nonSF = 0, noDate = 0;

  for (const url of hrefs) {
    if (seen.has(url)) continue;
    seen.add(url);
    // Non-SF studios share the index; skip them without spending a fetch.
    if (!CLAY_SF_HOSTS.test(url)) { nonSF++; continue; }

    const page = await tSafe(url);
    if (!page) continue;

    const bodyText = clayPageText(page);
    const scheds = claySchedules(bodyText);
    if (!scheds.length) { noDate++; continue; }

    const address = clayAddress(page, url);

    const title = clayTitle(page) || "Clayroom class";
    for (const s of scheds) {
      if (s.iso.slice(0, 4) !== year || !days.includes(s.iso)) continue;
      const kept = register({
        id: `clay-${url.split("/").pop()}-${s.iso}`,
        title,
        venue: VENUE,
        neighborhood: "San Francisco",
        address,
        description: "",
        date: s.iso,
        startMinutes: parseTimeToMinutes(s.label),
        timeLabel: s.label,
        priceLabel: null,
        priceTier: "unknown",
        categories: ["Talks & Workshops"],
        url,
        linkTier: "venue",
      });
      if (kept) added++;
    }
  }
  console.log(
    `  clayroom: ${added} in-window events (${seen.size} class pages, ` +
    `${nonSF} non-SF skipped, ${noDate} with no parsable date)`);
}

// ---------------------------------------------------------------------------
// 4. SCRAP (Scrap Creative Center) — Google Sites
//
// Measured against the live /workshops page on 2026-10-02.
//
// The obvious approach — a browser — is not needed, and this comment records
// why so nobody repeats the 2.7 MB probe. Google Sites emits every visible line
// as a run of `<span class="C9DxTc ">` fragments and sometimes splits one token
// across spans ("11:00" arrives as `>1</span><span>1</span><span>:00 </span>`).
// Tag-stripping the whole document therefore glues the page into one 118 KB
// run-on string where no per-workshop boundary survives.
//
// What survives is the BLOCK boundary. Each rendered line is the content of
// exactly one block element, so joining spans WITHIN a block while keeping one
// entry per block reproduces the rendered page. That was verified against the
// live document before this parser was written; it is the reason this is a
// plain fetch with no browser.
//
// The workshop block, in order, with the optional lines marked:
//   kicker       SCRAP STAFF-LED WORKSHOP     (absent on some)
//   title        Spellbound Bookmaking
//   instructor   LaVera Wilson
//   date         Sunday, October 11
//   time         11 AM - 1 PM
//   status       ONE SPOT LEFT! / SOLD OUT    (absent on most)
//   description  ...
//   action       REGISTER HERE
//
// Two traps a naive parse falls into, both handled below:
//
//   * The kicker is NOT a reliable marker — the first workshops have one and
//     "Boroboro: Japanese Mending" does not. The DATE is the anchor and the
//     title is read UPWARD from it. Anchoring on the optional line is how a
//     parser silently loses a workshop.
//   * The page has no year anywhere except the section header ("WORKSHOPS
//     2026"). Assuming the current year puts every January workshop twelve
//     months in the past, so the year is carried forward from the section as
//     the walk descends the page.
//
// "PAST WORKSHOPS 2026" rows and sold-out sessions are both filtered by the day
// window and an explicit SOLD OUT check, so neither needs its own heading rule.
const SCRAP_URL = "https://www.scrap-sf.org/workshops";
const SCRAP_VENUE = "Scrap Creative Center";
const SCRAP_ADDRESS = "141 Industrial St, San Francisco, CA 94124";

const SCRAP_DOW = "Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday";
const SCRAP_MONTHS = ("January|February|March|April|May|June|July|August|September|October|" +
                      "November|December");

// "Sunday, October 11"
const SCRAP_DATE_RX = new RegExp(
  `^\\s*(?:(?:${SCRAP_DOW})[a-z]*,?\\s+)?(${SCRAP_MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*$`, "i");

// "11 AM - 1 PM" / "5 PM - 7:30 PM" / "11AM-1PM"
const SCRAP_TIME_RX = /^\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*$/i;

// A standalone clock, for a block that states only a start.
const SCRAP_STARTTIME_RX = /^\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*$/i;

// "11 am" -> "11 AM", "7:30pm" -> "7:30 PM"
function scrapNormClock(s) {
  return String(s).trim().replace(/\s+/g, " ")
    .replace(/^(\d{1,2}:\d{2}|\d{1,2})\s*(am|pm)$/i, (m, h, ap) => `${h} ${ap.toUpperCase()}`);
}

const SCRAP_MONTH_INDEX = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// Page chrome and site furniture — never a workshop title.
const SCRAP_CHROME_RX = new RegExp(
  `^(?:${SCRAP_DOW}|Skip\\s+to\\s+main\\s+content|Skip\\s+to\\s+navigation|` +
  `SCRAP\\s+NEEDS\\s+YOUR\\s+SUPPORT!?|DONATE\\s+TODAY|HomeAbout\\s+Us.*|` +
  `Workshop\\s+Calendar|VISIT\\s*&\\s*CONTACT|Mailing\\s+Address|^Phone$|` +
  `Write\\s+to\\s+us|SUPPORT\\s+SCRAP|DROP-OFF.*|NEWSLETTER\\s+SIGN-?UP|` +
  `DONATE\\s+MATERIALS|DONATE\\s+FUNDS|.*rights\\s+reserved.*|Report\\s+abuse|` +
  `FOLLOW\\s+SCRAP.*|©\\s*\\d{4}.*)$`, "i");

// A section header. The year is stated here and nowhere else on the page.
const SCRAP_SECTION_RX = /(?:WORKSHOPS?|EVENTS?)\s*&?\s*(?:POP-?UPS?|WORKSHOPS?)?\s*((?:19|20)\d{2})$/i;

// "SOLD OUT" / "ONE SPOT LEFT!" — a status badge, never a title.
const SCRAP_STATUS_RX = /^(?:SOLD\s*OUT!?|ONE\s+SPOT\s+LEFT!?|\d+\s+SPOTS?\s+LEFT!?)$/i;

// The registration link that closes a block.
const SCRAP_ACTION_RX = /^(?:REGISTER(?:\s+HERE)?|SIGN\s+UP.*|BUY\s+TICKETS?.*)$/i;

// A title starts with a letter OR a series number. "102: Pockets" is a real
// workshop title on the live page, and a guard of `^[^A-Za-z]` rejected it —
// which then left the block with one name above the date and filed the
// INSTRUCTOR as the title. Leading digits are allowed; a line that starts with
// anything else (a price, a bullet, a stray bracket) is not a name.
const SCRAP_TEXT_RX = /^(?:[A-Za-z]|\d+\s*:)/;

// A finished SENTENCE that has drifted into the title slot.
//
// Word count cannot separate the two populations: measured over all 64 title
// slots on the live page, the longest real title is 12 words ("Maps as a Tool
// for Artistic Expression & Exploration of Visual Ideas") and the shortest
// description is 11 ("All materials provided. No experience necessary."). Any
// cap low enough to reject the description also rejects the title.
//
// The discriminator that does work is the period. Every line that ended up in a
// title slot while being a description ends with ".", while every real title
// that punctuates at all ends with "!" ("Visible Mending: Patch your jeans by
// hand!"). Requiring a period AND a lowercase function word separates the two
// populations cleanly: a title is Title Case and has neither. See
// probes/scrap-titleshape.mjs for the measurement.
const SCRAP_SENTENCE_RX = /\.\s*$/;
const SCRAP_FUNCTION_WORD_RX =
  /\b(?:you|your|will|learn|the|and|with|this|that|from|for|are|can|we|our|provided|necessary|welcome|required|experience|all|no)\b/i;

// A title is prose, not a date, not a clock, not a status, not chrome.
function scrapIsTitle(s) {
  if (!s || s.length > 90) return false;
  if (SCRAP_DATE_RX.test(s)) return false;
  if (SCRAP_TIME_RX.test(s)) return false;
  if (SCRAP_STARTTIME_RX.test(s)) return false;
  if (SCRAP_STATUS_RX.test(s)) return false;
  if (SCRAP_ACTION_RX.test(s)) return false;
  if (SCRAP_CHROME_RX.test(s)) return false;
  if (SCRAP_SECTION_RX.test(s)) return false;
  if (!SCRAP_TEXT_RX.test(s)) return false;
  // Body copy, not a name. Two signals, because one is not enough: the cap
  // catches long prose and the sentence test catches the short descriptions
  // that fit under it.
  //
  // The cap is 12, not 10. Measured against every block on the live page: the
  // longest real title is "Maps as a Tool for Artistic Expression & Exploration
  // of Visual Ideas" at 12 words, which a 10-word cap rejected — and because
  // the block then has only one surviving name above the date, the instructor
  // got filed as the title. A cap below the longest real title does not make
  // the parse stricter, it makes it wrong. See probes/scrap-series.mjs.
  if (s.split(/\s+/).length > 12) return false;
  // A description that drifted into the title slot. Needs BOTH signals: the
  // real title "Visible Mending: Patch your jeans by hand!" ends in "!" and
  // carries the lowercase word "your", so either test alone would drop it.
  if (SCRAP_SENTENCE_RX.test(s) && SCRAP_FUNCTION_WORD_RX.test(s)) return false;
  return true;
}

// The shouted kicker ("SCRAP STAFF-LED WORKSHOP"). All-caps is the only reliable
// signal, because the kicker is absent on many blocks and its wording varies.
function scrapIsKicker(s) {
  const letters = [...s].filter((c) => /[a-z]/i.test(c));
  return letters.length > 0 && letters.every((c) => c === c.toUpperCase());
}

// Split the static document into rendered lines: one entry per block element,
// with the spans inside it joined. This is the whole decode trick.
function scrapLines(html) {
  const start = html.indexOf("<body");
  const body = start >= 0 ? html.slice(start) : html;
  const beforeScript = body.split(/<script\b/i)[0];
  const lines = [];
  for (const m of beforeScript.matchAll(/<(h1|h2|h3|h4|h5|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const txt = decodeEntities(m[2].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
    if (txt) lines.push(txt);
  }
  return lines;
}

// Assemble one workshop from the lines around the date at index i.
function scrapBlock(lines, i, year) {
  const dm = lines[i].match(SCRAP_DATE_RX);
  if (!dm) return null;

  const y = year || new Date().getFullYear();
  const mi = SCRAP_MONTH_INDEX[String(dm[1]).toLowerCase()];
  if (!mi) return null;
  const date = `${y}-${String(mi).padStart(2, "0")}-${String(Number(dm[2])).padStart(2, "0")}`;
  if (Number(dm[2]) > 31) return null;

  // Time. A range is the usual shape; a bare clock is accepted. Neither being
  // present is an error — a workshop with no stated time still belongs in the
  // feed with "Time TBA", because dropping it would hide a real workshop.
  const tm = lines[i + 1] ? lines[i + 1].match(SCRAP_TIME_RX) : null;
  const sm = !tm && lines[i + 1] ? lines[i + 1].match(SCRAP_STARTTIME_RX) : null;
  let timeLabel = "Time TBA", startMinutes = -1, endMinutes = -1;
  if (tm) {
    startMinutes = parseTimeToMinutes(tm[1]);
    endMinutes = parseTimeToMinutes(tm[2]);
    const a = scrapNormClock(tm[1]), b = scrapNormClock(tm[2]);
    timeLabel = a === b ? a : `${a}\u2013${b}`;
  } else if (sm) {
    startMinutes = parseTimeToMinutes(sm[1]);
    timeLabel = scrapNormClock(sm[1]);
  }

  // Title and instructor, read upward from the date.
  //
  // The live block is  title / instructor / date  — the instructor sits
  // DIRECTLY above the date, so "the nearest name above the date" is the
  // instructor, not the title. Measured across all 82 dated blocks on the page:
  // 81 carry an instructor line and 1 does not, so the title is read as the
  // next name up and the single-instructor-less block falls back to the nearest.
  // Reading upward for the NEAREST name is what silently filed every workshop
  // under the name of its teacher, which is why this is a fixed offset and not
  // a first-match search.
  let title = null, instructor = null;
  const names = [];
  for (let j = i - 1; j >= 0 && i - j <= 3; j--) {
    if (SCRAP_DATE_RX.test(lines[j]) || SCRAP_SECTION_RX.test(lines[j])) break;
    if (scrapIsKicker(lines[j])) continue;       // the shouted category line
    if (scrapIsTitle(lines[j])) names.push(lines[j]);
  }

  if (names.length >= 2) { title = names[1]; instructor = names[0]; }
  else if (names.length === 1) { title = names[0]; }
  if (!title) return null;

  // Status, anywhere in the block before the action link. SOLD OUT is a hard
  // skip: publishing a session nobody can book is worse than omitting it.
  let soldOut = false;
  for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
    const s = lines[j];
    if (SCRAP_ACTION_RX.test(s)) break;
    if (/SOLD\s*OUT/i.test(s)) { soldOut = true; break; }
  }

  // Description: the first prose line after the time, up to the action link.
  let description = "";
  for (let j = i + 2; j < Math.min(lines.length, i + 7); j++) {
    const s = lines[j];
    if (SCRAP_ACTION_RX.test(s) || SCRAP_DATE_RX.test(s)) break;
    if (s.length > 60 && !SCRAP_STATUS_RX.test(s)) { description = s; break; }
  }

  // Free is not stated anywhere on the page, so the tier is "unknown" rather
  // than a price the venue never published.
  return { date, timeLabel, startMinutes, endMinutes, title, instructor, description, soldOut };
}

async function scrap(days) {
  const html = await tSafe(SCRAP_URL);
  if (!html) return console.log("  scrap: page unavailable — skipped");

  const lines = scrapLines(html);
  const inWindow = new Set(days);

  // The year is carried forward from the section header as the walk descends.
  let year = new Date().getFullYear();
  let added = 0, soldOut = 0, noTitle = 0, dated = 0;

  for (let i = 0; i < lines.length; i++) {
    const stated = lines[i].match(SCRAP_SECTION_RX);
    if (stated) { year = Number(stated[1]); continue; }
    if (!SCRAP_DATE_RX.test(lines[i])) continue;
    dated++;

    const b = scrapBlock(lines, i, year);
    if (!b) { noTitle++; continue; }
    if (b.soldOut) { soldOut++; continue; }
    // The day window is the only date filter; past sections drop out here.
    if (!inWindow.has(b.date)) continue;

    const title = b.instructor ? `${b.title} with ${b.instructor}` : b.title;
    const kept = register({
      id: `scrap-${b.date}-${b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      title,
      venue: SCRAP_VENUE,
      neighborhood: "Dogpatch",
      address: SCRAP_ADDRESS,
      description: b.description,
      date: b.date,
      startMinutes: b.startMinutes,
      endMinutes: b.endMinutes,
      timeLabel: b.timeLabel,
      priceLabel: null,
      priceTier: "unknown",
      categories: ["Talks & Workshops"],
      url: SCRAP_URL,
      linkTier: "venue",
      instructor: b.instructor || undefined,
    });
    if (kept) added++;
  }

  console.log(
    `  scrap: ${added} in-window events (${dated} dated blocks, ` +
    `${soldOut} sold out, ${noTitle} without a title)`);
}

// SCRAP lives here as the fourth hand-kept venue. The dispatch order and the
// call site are in fetch.mjs, which owns `days` — a separate index function
// here would be dead code.
export { centerForTheBook, workshopSF, clayroom, scrap, scrapLines, scrapBlock, scrapIsTitle, scrapIsKicker, CLAY_SF_HOSTS, SCRAP_URL, SCRAP_VENUE, SCRAP_DATE_RX, SCRAP_SECTION_RX, SCRAP_CHROME_RX, SCRAP_ACTION_RX, claySchedules, clayTitle, clayDate, clayPageText, clayAddress };
