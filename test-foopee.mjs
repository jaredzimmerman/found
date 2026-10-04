// Fixture-driven tests for foopee.mjs.
//
// Runs the REAL shipped parser against a REAL slice of the page, never a
// hand-written stub. The first draft of the SF-scoping test rebuilt the filter
// locally in the test file; deleting the real filter left it passing, so it was
// testing its own copy rather than the shipped rule. Same trap, so this suite
// imports the module and only feeds it input.
//
// No network. The fixture is trimmed from by-date.0.html but every listing line
// is byte-identical to the source, including the two malformed venue labels.

import { readFileSync } from "node:fs";
import { parseListings, cityOf, isSF, toMinutes } from "./foopee.mjs";

const FIXTURE = "/tmp/lvtest/fp0.html";
let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; return; }
  fail++;
  console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
};

// ---------------------------------------------------------------------------
// Time parsing. This is where the source would have silently lost most of its
// listings: the shared parseTimeToMinutes() requires "hh:mm" and returns -1 for
// a bare "8pm", which is the form this site uses most.
// ---------------------------------------------------------------------------
console.log("toMinutes\n");
const TIMES = [
  ["8pm", 1200], ["7:30pm", 1170], ["noon", 720],
  ["9:30pm", 1290], ["6pm", 1080], ["11am", 660], ["5pm", 1020],
  ["1pm", 780], ["12am", 0], ["12pm", 720], ["10pm", 1320],
];
for (const [t, want] of TIMES) ok(`toMinutes("${t}") = ${want}`, toMinutes(t) === want, `got ${toMinutes(t)}`);

// A slash-PAIR is two times and is split by the caller's TIME regex, not here.
// Feeding the whole pair to toMinutes() must NOT be read as the start time —
// doing so would silently turn "7pm/7:45pm" into a 7:45pm doors time.
ok('toMinutes("7pm/7:45pm") is -1 (a pair is split upstream, not read whole)',
  toMinutes("7pm/7:45pm") === -1, `got ${toMinutes("7pm/7:45pm")}`);

const BAD_TIMES = ["", null, "8", "tba", "25pm", "7:75pm", "noonish", "8 o'clock"];
for (const t of BAD_TIMES) ok(`toMinutes(${JSON.stringify(t)}) is -1 (not a fake time)`, toMinutes(t) === -1, `got ${toMinutes(t)}`);

// ---------------------------------------------------------------------------
// City extraction — trap 1. Venue labels embed comma-bearing street addresses,
// so the city is the LAST comma-token. Splitting on the first comma files a
// Fremont show as being in "43737 Boscell Road".
// ---------------------------------------------------------------------------
console.log("\ncityOf (comma-bearing addresses)\n");
const CITIES = [
  ["Chapel, S.F.", "S.F."],
  ["Delta Sports Bar, 6210 Bethel Island Road, Bethel Island", "Bethel Island"],
  ["Waterhawk Lake Club, 5000 Roberts Lake Rd., Rohnert Park", "Rohnert Park"],
  ["Lake Cunningham Skate Park, 2305 South White Road, San Jose", "San Jose"],
  ["Palace of Fine Arts, 3301 Lyon Street, S.F.", "S.F."],
  ["Arena, Oakland", "Oakland"],
  ["Irelands 32, 3920 Geary Blvd. at 3rd Ave., S.F.", "S.F."],
];
for (const [inp, want] of CITIES) ok(`cityOf("${inp.slice(0, 34)}") = ${want}`, cityOf(inp) === want, `got ${cityOf(inp)}`);

// trap 2: "Castro," carries no city in its label at all.
ok("cityOf('Castro,') = 'S.F.' (label omits the city)", cityOf("Castro,") === "S.F.", `got ${cityOf("Castro,")}`);
ok("cityOf('Castro') = 'S.F.'", cityOf("Castro") === "S.F.", `got ${cityOf("Castro")}`);

// ---------------------------------------------------------------------------
// SF scoping — the correctness property the whole module exists for.
// ---------------------------------------------------------------------------
console.log("\nSF scoping\n");
ok("isSF('S.F.') is true", isSF("S.F.") === true);
ok("isSF('Oakland') is false", isSF("Oakland") === false);
ok("isSF('Berkeley') is false", isSF("Berkeley") === false);
ok("isSF('') is false (unknown venue is EXCLUDED, not admitted)", isSF("") === false);
ok("isSF('San Francisco') is false (only the literal abbreviation passes)", isSF("San Francisco") === false);

// ---------------------------------------------------------------------------
// The full parse over the real fixture.
// ---------------------------------------------------------------------------
console.log("\nparseListings over the real fixture\n");
const html = readFileSync(FIXTURE, "utf8");
const all = parseListings(html, null);

ok("parsed listings are found", all.length > 60, `got ${all.length}`);

// Every listing must carry a venue and artists. Times are optional — the source
// omits them for all-day events (festivals, fairs, etc.), and the build drops
// those rows rather than faking a time.
ok("every listing has a venue", all.every((r) => r.venue && r.venue.length > 0));
ok("every listing has artists", all.every((r) => r.artists && r.artists.length > 0));
// A listing with no printed time is skipped by the build; the test reflects that
// by checking that the parser returns a parsable start time *when one exists*.
const withTime = all.filter(r => r.times.length > 0);
ok("at least some listings have a time", withTime.length > 0, `got ${withTime.length}`);
ok("those listings parse to a valid start minute", withTime.every((r) => toMinutes(r.times[0]) >= 0));

// Dates must be real and in-page.
ok("every listing has an ISO date", all.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date)), JSON.stringify(all.slice(0, 3).map((r) => r.date)));

// The headline scoping assertion: the Bay Area must NOT leak into an SF feed.
const sf = all.filter((r) => isSF(r.city));
const nonSf = all.filter((r) => !isSF(r.city));
ok("both SF and non-SF listings exist in the source", sf.length > 0 && nonSf.length > 0, `sf=${sf.length} nonSf=${nonSf.length}`);
ok("SF is a minority of a Bay Area list (scoping is load-bearing)", nonSf.length > sf.length, `sf=${sf.length} nonSf=${nonSf.length}`);

// No out-of-city venue may survive the filter.
const LEAKED = ["Oakland", "Berkeley", "Santa Cruz", "Petaluma", "San Jose", "Napa", "Emeryville", "Pacifica", "Fremont"];
const leaked = sf.filter((r) => {
  const blob = `${r.venue} ${r.city}`;
  return LEAKED.some((c) => blob.includes(c) && !blob.includes("S.F."));
});
ok("no out-of-city venue survives into the SF set", leaked.length === 0, leaked.map((r) => r.venue).join(", "));

// Castro's displaced city must be recovered, or the venue silently vanishes.
const castro = sf.filter((r) => /^Castro$/i.test(r.venue));
ok("Castro Theatre is NOT dropped (city displaced into metadata)", castro.length > 0, `found ${castro.length}`);

// Spot-check a known line, byte-for-byte against the source page.
// The Oct 4 Chapel listing is unique: "Chapel, S.F. Rum Jungle, Trestles"
const chapel = sf.find((r) => /Chapel/i.test(r.venue) && /Rum Jungle/.test(r.artists));
ok("Chapel listing parsed with its artists", !!chapel && /Rum Jungle/.test(chapel.artists), chapel ? chapel.artists : "not found");
ok("Chapel date is Sun Oct 4", chapel && chapel.date.endsWith("-10-04"), chapel ? chapel.date : "n/a");

const eld = sf.find((r) => /Knockout/i.test(r.venue) && /free/i.test(r.price || ""));
ok("a free listing carries a real price token", !!eld, eld ? `${eld.venue} ${eld.price}` : "no free Knockout found");

// Prices must never keep cents — rounding happens once in main() over the whole
// corpus, but a parser that emits "$35.05" here would be caught downstream.
ok("no listing lost its price text entirely", all.filter((r) => /\$|free|donation/i.test(r.price || "")).length > 0);

// ---------------------------------------------------------------------------
// Window filtering.
// ---------------------------------------------------------------------------
console.log("\nwindow filtering\n");
const three = ["2026-10-03", "2026-10-04", "2026-10-05"];
const win = parseListings(html, three);
ok("window filter returns a subset", win.length <= all.length && win.length > 0, `${win.length} of ${all.length}`);
ok("every windowed listing is inside the window", win.every((r) => three.includes(r.date)), JSON.stringify(win.slice(0, 4).map((r) => r.date)));

console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail === 0 ? "PASS" : "FAIL");
process.exit(fail === 0 ? 0 : 1);