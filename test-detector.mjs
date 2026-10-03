// Unit-test the sold-out detector against known inputs.
//
// Live data alone cannot prove the detector works: a given day may contain no
// sold-out event at all, and the suite would pass while the filter was dead.
// These cases pin the behaviour, including the false-positive traps that a
// bare "sold out" substring match would trip on.
//
// The implementation under test is EXTRACTED from fetch.mjs at run time, so
// this file cannot drift from the code that actually ships. If the extractor
// cannot find it, the suite fails loudly rather than testing a stale copy.

import fs from "node:fs";

const SRC = "./fetch.mjs";
const src = fs.readFileSync(SRC, "utf8");

// Pull out the SOLD_OUT_RE constant and the soldOut function verbatim.
const reMatch = src.match(/const SOLD_OUT_RE\s*=\s*(\/.*?\/[a-z]*);/s);
const fnStart = src.indexOf("function soldOut(");
if (reMatch == null || fnStart === -1) {
  console.error("  FAIL  could not extract the detector from fetch.mjs");
  console.error("        the file was restructured; update the extractor");
  process.exit(1);
}
const fnEnd = src.indexOf("\nfunction normalize(", fnStart);
if (fnEnd === -1) {
  console.error("  FAIL  could not find the end of soldOut()");
  process.exit(1);
}
const fnSrc = src.slice(fnStart, fnEnd);

const SOLD_OUT_RE = eval(reMatch[1]);
const soldOut = eval(`(${fnSrc.replace(/^function soldOut/, "function")})`);

const YES = [
  [{ sold_out: true }, "", "api flag true"],
  [{ sold_out: "true" }, "", "api flag as string"],
  [{ soldOut: true }, "", "camelCase flag"],
  [{ sold_out: true }, "Tickets still available", "api flag beats stale copy"],
  [{}, "SOLD OUT.", "text: bare banner"],
  [{}, "This event has sold out.", "text: statement about this"],
  [{}, "Tickets are sold out for tonight", "text: tickets sold out"],
  [{}, "SOLD-OUT SHOW", "text: hyphenated"],
  [{}, "Out of stock", "text: out of stock"],
  [{}, "No tickets remaining", "text: no tickets remaining"],
  [{}, "No more seats available", "text: no more seats"],
  [{}, "Sold at capacity", "text: at capacity"],
  [{}, "Fully booked", "text: fully booked"],
];

// Each of these is a real way a naive substring match would hide a good event.
const NO = [
  [{}, "", "empty"],
  [{}, "The sold-out show returns next month", "past event, not this one"],
  [{}, "Our sold out album is back in stock", "album, not a listing"],
  [{}, "Join the waitlist when tickets sell out", "conditional, not a claim"],
  [{}, "Sold out? Ask about returns at the door", "a question, not a statement"],
  [{}, "Popular artists sell out fast", "generic prose about selling out"],
  [{}, "Their co-headline tour included sold-out shows nationwide",
    "back-catalogue (regression: hid 2 real concerts)"],
  [{}, "Previously sold out at the Warfield in 2019", "historical with a year"],
  [{}, "A record-breaking run of sold-out dates", "career retrospective"],
  [{ sold_out: false }, "Tickets available", "explicit false flag"],
  [{ sold_out: null }, "Doors at 8pm", "null flag, ordinary listing"],
  [{}, "The outsold player", "not a sold-out event"],
];

let fails = 0;
for (const [e, raw, label] of YES) {
  if (!soldOut(e, raw)) { console.log(`  FAIL  should flag: ${label}`); fails++; }
  else console.log(`  PASS  flags  ${label}`);
}
for (const [e, raw, label] of NO) {
  if (soldOut(e, raw)) { console.log(`  FAIL  wrong flag: ${label}`); fails++; }
  else console.log(`  PASS  ignores ${label}`);
}

console.log();
console.log(fails ? `${fails} FAILED` : `ALL GOOD (${YES.length + NO.length} cases)`);
process.exit(fails ? 1 : 0);
