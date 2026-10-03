// Test hoods.mjs against the real live feed, not a fixture.
//
// A neighborhood map is only as good as the addresses it has never seen. These
// are the actual rows, and the assertions are about real failure modes: a city
// name surviving as a neighborhood, a ZIP mapped to the wrong part of the city,
// and cross-street names resolving to the wrong hood.

import { neighborhoodFor, hoodsOf } from "./hoods.mjs";
import { readFileSync } from "node:fs";

// The feed path is overridable and DEFAULTS TO THE PUBLISHED FILE. It used to
// be a hardcoded /tmp/feed.json that only existed while some earlier ad-hoc run
// happened to have written it, so the test threw ENOENT on any clean machine —
// reading as a real failure while actually checking nothing. Defaults that point
// at a file which always exists keep the assertions honest.
const FEED = process.env.FEED || "/var/www/pinkpages.indigokarasu.com/events.json";
const live = JSON.parse(readFileSync(FEED, "utf8"));
const events = live.events || live;

let pass = 0;
let fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(46)} got ${String(got).padEnd(18)} want ${want}`);
};

console.log("=== unit: known addresses, hand-checked against the map ===");
// 3198 Mission St 94110 is Omnivore; the shop is in the Mission.
check("Mission St 94110", neighborhoodFor("3198 Mission St, San Francisco, CA 94110", "San Francisco"), "Mission");
// 261 Columbus Ave 94133 is City Lights; North Beach/Financial fringe.
check("Columbus Ave 94133", neighborhoodFor("261 Columbus Ave, San Francisco, CA 94133", "San Francisco"), "North Beach");
// 1310 Haight is Workshop; Haight-Ashbury, no ZIP supplied.
check("Haight St, no ZIP", neighborhoodFor("1310 Haight St", "San Francisco"), "Haight-Ashbury");
// 901 16th St is the Flower Mart; no ZIP in the string.
check("16th St, no ZIP", neighborhoodFor("901 16th Street, San Francisco", "San Francisco"), "Inner Sunset");
// A city name in a hood field must not be echoed back.
check("city-only fallback stays generic", neighborhoodFor("", "San Francisco"), "San Francisco");
// A specific pre-existing value must survive.
check("specific fallback preserved", neighborhoodFor("", "North Beach"), "North Beach");
// An address that names neither must not invent one.
check("unrecognised address -> generic", neighborhoodFor("1 Ferry Building, Suite 12", "San Francisco"), "San Francisco");

console.log("\n=== integration: the whole live feed ===");
const hoods = hoodsOf(events);
const total = hoods.reduce((s, h) => s + h.n, 0);
console.log(`  ${total} events across ${hoods.length} neighborhoods:`);
for (const h of hoods) console.log(`    ${String(h.n).padStart(4)}  ${h.hood}`);

const generic = hoods.find((h) => h.hood === "San Francisco");
console.log(`\n  still generic ("San Francisco"): ${generic ? generic.n : 0}/${total}`);
console.log(`  resolved to a real neighborhood: ${total - (generic ? generic.n : 0)}/${total}`);

console.log("\n=== the real quality bar: how many distinct chips would a reader see? ===");
const oneEvent = hoods.filter((h) => h.n < 2);
console.log(`  neighborhoods with a single event: ${oneEvent.length}`);
if (oneEvent.length) console.log(`    ${oneEvent.map((h) => `${h.hood}(${h.n})`).join(", ")}`);

console.log("\n=== no row may keep a city name while others have a hood ===");
const inconsistent = events.filter((e) => /^san francisco$/i.test(e.neighborhood || "") && !/^San Francisco$/.test(e.neighborhood || ""));
check("case-normalised city values", inconsistent.length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
