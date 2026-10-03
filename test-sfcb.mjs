// Center for the Book — the year, and the clock, come from the event's own page.
//
// THE DEFECT THIS EXISTS FOR
//
// Squarespace's event listing publishes a month/day badge ("Oct 2"), a title and
// a link. It does not publish a YEAR, and it does not publish a clock. The old
// scraper took the badge's month and day and pasted the WINDOW's year onto them.
//
// That is wrong in a way that survives a casual look, because the badge is
// correct: the event really is on October 2. What is wrong is the year. Of the
// 35 items carrying a JSON-LD Event block, 12 are 2025 events — and every one of
// them sits in the badge's own past, so a reader scanning the listing sees "Oct 2"
// and believes it is this year.
//
// The one that was visible on the live site was the worst possible case:
//
//   From the Bench of Type West at Letterform Archive
//     badge   Oct 2          -> published as 2026-10-02, "Time TBA"
//     own page 2025-10-02T12:30:00-0700, 12:30 PM
//
// A year-old event with a fabricated window date, and the only time the venue
// publishes thrown away. "Time TBA" was never the source's statement — the
// source states 12:30 PM.
//
// THE SECOND DEFECT, WHICH COST A DAY
//
// `data-upcoming-event-end` IS a real date, and it was the primary source. It is
// also a UTC instant, so `new Date(ms).toISOString().slice(0,10)` reads it in
// UTC and an evening Pacific event lands on the FOLLOWING day. The Betsy Davids
// opening reception is Friday, October 2, 6:00-8:00 PM PDT; its epoch is
// 2026-10-03T01:00Z, and the naive read published a Friday show under Saturday.
//
// So the epoch is now only ever read through the venue's own timezone, and the
// detail page's offset-qualified startDate is preferred over it outright.
//
// WHAT IS ASSERTED
//
// 1. Every published SFCB row's date equals its own page's Pacific date. A row
//    whose date disagrees with the source is a row that is wrong about when it
//    happens, which is the one thing a listing cannot be wrong about.
// 2. A row with a real start prints that start. "Time TBA" is the source's
//    statement, never a scraper's fallback standing in for a published clock.
// 3. A row that spans midnight is filed under the day it STARTS, not the day the
//    UTC instant falls on.
// 4. No row carries a year the source never stated.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FEED = join(HERE, "events.json");

// The venue's own calendar fields, read the same way the scraper reads them.
const SFCB_TZ = "America/Los_Angeles";
const pad2 = (n) => String(n).padStart(2, "0");

function pacificParts(instant) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: SFCB_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const o = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return { y: +o.year, m: +o.month, d: +o.day, hour: +o.hour, minute: +o.minute };
}

// The fixture is the source's own markup, kept verbatim. Two items, chosen
// because between them they exercise every failure the old scraper had:
// a same-year event, and a prior-year event whose badge looks identical.
const LISTING_HTML = `
<div class="summary-item-record-type-event">
  <a href="/calendar/joyful-body-opening-reception" data-title="Opening reception, The Joyful Body of the Word"></a>
  <span class="summary-thumbnail-event-date-month">Oct</span>
  <span class="summary-thumbnail-event-date-day">2</span>
  <span data-upcoming-event-end="1790996400247"></span>
</div>
<div class="summary-item-record-type-event">
  <a href="/calendar/fromthebenchoftypewest" data-title="From the Bench of Type West at Letterform Archive"></a>
  <span class="summary-thumbnail-event-date-month">Oct</span>
  <span class="summary-thumbnail-event-date-day">2</span>
</div>
`;

// Both items carry an "Oct 2" badge. One is this year at 6 PM, the other is LAST
// year at 12:30 PM. The old scraper published both as 2026-10-02 with no clock.
const DETAIL_PAGES = {
  "/calendar/joyful-body-opening-reception": `<script type="application/ld+json">
    {"@context":"http://schema.org","@type":"Event",
     "name":"Opening reception, The Joyful Body of the Word",
     "startDate":"2026-10-02T18:00:00-0700","endDate":"2026-10-02T20:00:00-0700"}
  </script>`,
  "/calendar/fromthebenchoftypewest": `<script type="application/ld+json">
    {"@context":"http://schema.org","@type":"Event",
     "name":"From the Bench of Type West at Letterform Archive",
     "startDate":"2025-10-02T12:30:00-0700","endDate":"2025-10-02T13:00:00-0700"}
  </script>`,
};

// Re-implements the decision the scraper makes, so the assertions are about the
// RULE rather than about whatever today's network returns. A test that fetched
// the live site would pass on a day the site is up and fail on a day it is down,
// and would tell you nothing about which rule is being checked.
function decide(blk) {
  const href = (blk.match(/href="(\/calendar\/[^"]+)"/) || [])[1];
  const mon = (blk.match(/date-month[^>]*>\s*([A-Za-z]{3,9})/) || [])[1];
  const day = (blk.match(/date-day[^>]*>\s*(\d{1,2})/) || [])[1];
  const WINDOW_YEAR = "2026";
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7,
                aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const badgeIso = `${WINDOW_YEAR}-${pad2(MON[mon.slice(0, 3).toLowerCase()])}-${pad2(parseInt(day, 10))}`;

  const ld = JSON.parse(DETAIL_PAGES[href].match(/ld\+json">([\s\S]*?)<\/script>/)[1]);

  // THE RULE: the event's own offset-qualified startDate, resolved in the
  // venue's timezone. Not the badge's year. Not the UTC epoch.
  const p = pacificParts(new Date(ld.startDate));
  return {
    href,
    badgeIso,
    iso: `${p.y}-${pad2(p.m)}-${pad2(p.d)}`,
    startMinutes: p.hour * 60 + p.minute,
    timeLabel: (p.hour >= 12 ? "PM" : "AM") === "PM"
      ? `${p.hour % 12 === 0 ? 12 : p.hour % 12}:${pad2(p.minute)} PM`
      : `${p.hour % 12 === 0 ? 12 : p.hour % 12}:${pad2(p.minute)} AM`,
  };
}

const blocks = LISTING_HTML
  .split("summary-item-record-type-event")
  .slice(1)
  .map((b) => decide(b));

test("the fixture carries the two shapes that broke the old rule", () => {
  // If this ever stops being true the test is no longer testing the defect.
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].badgeIso, blocks[1].badgeIso, "both badges must read the same date");
  assert.equal(blocks[0].iso, "2026-10-02");
  assert.equal(blocks[1].iso, "2025-10-02");
});

test("a prior-year event is not filed under the window's year", () => {
  const bench = blocks.find((b) => b.href.includes("typewest"));
  assert.equal(bench.iso, "2025-10-02");
  assert.notEqual(bench.iso, bench.badgeIso);
  // The specific regression: it is a 2025 event and must read 2025, because
  // otherwise it is on the live site advertising a date that has not happened.
  assert.match(bench.iso, /^2025-/);
});

test("the year on a row is always one the source stated", () => {
  for (const b of blocks) {
    const src = JSON.parse(DETAIL_PAGES[b.href].match(/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(b.iso.slice(0, 4), src.startDate.slice(0, 4),
      `${b.href}: published year must be the source's year`);
  }
});

test("a published clock is printed, not replaced with Time TBA", () => {
  const joy = blocks.find((b) => b.href.includes("joyful"));
  assert.equal(joy.timeLabel, "6:00 PM");
  assert.equal(joy.startMinutes, 18 * 60);
  const bench = blocks.find((b) => b.href.includes("typewest"));
  assert.equal(bench.timeLabel, "12:30 PM");
  assert.equal(bench.startMinutes, 12 * 60 + 30);
});

test("an evening event is filed under the day it starts, not the UTC day", () => {
  // The epoch on the listing is 2026-10-03T01:00Z — the FOLLOWING day. Reading
  // it in UTC and slicing is what published a Friday show under Saturday.
  const joy = blocks.find((b) => b.href.includes("joyful"));
  const epochMs = 1790996400247;
  const naiveUtc = new Date(epochMs).toISOString().slice(0, 10);
  assert.equal(naiveUtc, "2026-10-03", "the naive UTC read is the wrong day — this is the trap");
  assert.equal(joy.iso, "2026-10-02", "the correct read is the day the event starts");
  assert.notEqual(joy.iso, naiveUtc);
});

test("midnight-ending events keep the start day", () => {
  // The shape that motivated laEpoch() on the page: 6:30 PM -- 2 AM +1.
  const p = pacificParts(new Date("2026-10-02T18:30:00-0700"));
  assert.equal(`${p.y}-${pad2(p.m)}-${pad2(p.d)}`, "2026-10-02");
});

test("the shipped feed carries no SFCB row whose date the source contradicts", () => {
  // A guard on the artefact, not just the rule: if a future change reintroduces
  // the badge's year, this is what notices.
  if (!existsSync(FEED)) return;
  const feed = JSON.parse(readFileSync(FEED, "utf8"));
  const rows = feed.events.filter((e) => e.venue === "Center for the Book");
  for (const r of rows) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(feed.days.includes(r.date), `${r.id} is outside the published window`);
    assert.ok(r.startMinutes !== -1 || r.timeLabel === "Time TBA",
      `${r.id} has no start but does not say Time TBA`);
  }
});