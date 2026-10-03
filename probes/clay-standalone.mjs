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

const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
const decodeEntities = (s) => String(s).replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ");
const CLAY_SF_HOSTS = /clayroomsf\.com|clayroomsoma\.com/i;

// SF studio addresses, matched against the venue line the class page prints.
const CLAY_SF_ADDRESS = [
  [/1431\s+17th Street/i, "1431 17th St, San Francisco, CA 94107"],
  [/9th Street/i, "727 9th St, San Francisco, CA 94103"],
  [/651\s+8th Street|651\s+8th St/i, "651 8th St, San Francisco, CA 94103"],
];

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


export { claySchedules, clayPageText, clayTitle };
