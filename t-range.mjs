// Unit test for the time-range formatter. Tests the REAL functions by
// importing them, so this cannot pass against a copy that has drifted from
// the shipped source.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./fetch.mjs", import.meta.url), "utf8");

// Pull the two functions out of the source and evaluate them, so a signature
// change in fetch.mjs cannot leave this test green against a stale copy.
const grab = (re) => {
  const m = src.match(re);
  if (!m) throw new Error(`could not find ${re} in fetch.mjs`);
  return m[0];
};
const code = grab(/const clock = \(mins\) => \{[\s\S]*?\n\};/) + "\n" +
             grab(/function timeRangeLabel\(startMinutes, endMinutes\) \{[\s\S]*?\n\}/);
const mod = await import("data:text/javascript," + encodeURIComponent(
  code + "\nexport { timeRangeLabel, clock };"
));
const { timeRangeLabel: T, clock } = mod;

const at = (h, m = 0) => h * 60 + m;

const cases = [
  [T(at(17), at(20)),    "5 PM -- 8 PM",    "the brief's example"],
  [T(at(20), at(2)),     "8 PM -- 2 AM",    "crosses midnight; end stays in 0-1439"],
  [T(at(8), -1),         "8 AM",            "no end -> single time, never TBA"],
  [T(at(19, 30), at(21)), "7:30 PM -- 9 PM", ":00 dropped on the end"],
  [T(at(7, 30), at(7, 30)), "7:30 AM",       "zero-length span is not a range"],
  [T(-1, -1),            "Time TBA",        "nothing known"],
  [T(-1, at(20)),        "Time TBA",        "an end with no start is not a range"],
  [T(at(0), at(23, 59)), "12 AM -- 11:59 PM", "midnight start"],
  [T(at(12), at(12)),    "12 PM",           "noon; 12 PM is not 12 AM"],
  [T(at(0), at(0)),      "12 AM",           "midnight; 12 AM is not 12 PM"],
  [T(at(14), at(14, 0)), "2 PM",            "2:00 PM == 2 PM, no dupe"],
  [T(at(19), at(22, 30)), "7 PM -- 10:30 PM", "both ends carrying minutes"],
];

let bad = 0;
for (const [got, want, why] of cases) {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${JSON.stringify(got).padEnd(20)} want ${JSON.stringify(want).padEnd(18)} ${why}`);
}

// The separator must be exactly two hyphens: an en-dash or em-dash would be
// non-ASCII and the brief spelled it out.
const sep = T(at(17), at(20)).match(/\d [AP]M (.*) \d/)[1];
if (sep !== "--") { bad++; console.log(`  FAIL  separator is ${JSON.stringify(sep)}, want "--"`); }
else console.log('  PASS  separator is "--" (ASCII, as specified)');

console.log(`\n${cases.length + 1 - bad}/${cases.length + 1} pass`);
process.exit(bad ? 1 : 0);
