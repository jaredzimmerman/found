// Proves the two defects the brief flagged, on the SHIPPED functions.
//
// Both bugs were "the tests were green and the page was wrong", so nothing
// here may re-declare a copy of the logic under test. Everything is imported
// from the module that actually runs, or reconstructed by executing
// fetch.mjs's own source.
import { readFileSync } from "node:fs";

const DIR = new URL("./", import.meta.url);
const fetchSrc = readFileSync(new URL("./fetch.mjs", DIR), "utf8");
const cleanSrc = readFileSync(new URL("./title-clean.mjs", DIR), "utf8");

// ---------------------------------------------------------------------------
// 1. The blurb
// ---------------------------------------------------------------------------
const { cleanDescription } = await import("./title-clean.mjs");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

console.log("== blurb: the 'presents' opener ==");

// The exact string that shipped. Both a colon and a space are absent —
// "Presentsthe" is two words glued by an upstream stripper.
check(
  'colonless + glued "Presentsthe" is stripped',
  cleanDescription("Live Nation Presentsthe ghosted tour", "Cafe du Nord") ===
    "The ghosted tour",
  JSON.stringify(cleanDescription("Live Nation Presentsthe ghosted tour", "Cafe du Nord"))
);
check(
  "colon + space variant stripped",
  cleanDescription("Live Nation Presents the ghosted tour", "Cafe du Nord") ===
    "The ghosted tour"
);
check(
  "classic colon variant still stripped (regression)",
  cleanDescription("San Francisco Chronicle presents: a talk", "Cafe du Nord") ===
    "A talk"
);

// A false positive here would delete a real sentence. "presents" as a NOUN
// (gifts) is followed by no article, so the lookahead must decline.
check(
  'noun "presents" is NOT stripped',
  cleanDescription("Presents for every age, on every table", "Cafe du Nord") ===
    "Presents for every age, on every table"
);
check(
  '"presents" inside a sentence is NOT stripped',
  cleanDescription("A raffle where she presents the winner", "Cafe du Nord") ===
    "A raffle where she presents the winner"
);

// ---------------------------------------------------------------------------
// 2. The tags
// ---------------------------------------------------------------------------
// Pull categorize() and its two helpers out of fetch.mjs by running its real
// source in a sandbox. Re-declaring the tables here would be the exact mistake
// that let this ship once — a green test sitting next to a broken fetcher.
//
// The slice must start at MAP and run through the END of categorize(), or the
// helpers it calls (evidenceRatio, literalRe) are missing and the import fails
// with "Export 'evidenceRatio' is not defined" — which reads like a syntax
// error in fetch.mjs and is not one.
const start = fetchSrc.indexOf("const MAP = {");
const end =
  fetchSrc.indexOf("\n}", fetchSrc.indexOf("if (!result.length) return", start)) + 2;
const keys = fetchSrc.slice(start, end);

const catSrc = keys;

const { MAP, KEYWORDS, BOILERPLATE, CATEGORY_RANK, TITLE_MATCH, evidenceRatio, literalRe, categorize } =
  await import("data:text/javascript," + encodeURIComponent(
    catSrc +
      "\nexport { MAP, KEYWORDS, BOILERPLATE, CATEGORY_RANK, TITLE_MATCH, evidenceRatio, literalRe, categorize };"
  ));

console.log("\n== tags: boilerplate cannot invent a category ==");

// The proven case: a 21+ rap show whose only kid signal was the venue's
// admissions clause.
const rap = categorize(
  null,
  "saint harison",
  "Rickshaw Stop + Live Nation presentsthe ghosted tour. This event is 21+. " +
    "A valid ID required. All ages admission with a parent.",
  "Rickshaw Stop"
);
check(
  "21+ show is not tagged Family & Kids",
  !rap.includes("Family & Kids"),
  rap.join(" + ")
);

// A concert at a venue whose NAME is a food word. The venue echo is stripped,
// so the name cannot tag the gig.
const cafeGig = categorize(
  null,
  "Tobi Lou",
  "Doors at 7. An intimate evening of song. Cafe du Nord, a San Francisco landmark.",
  "Cafe du Nord"
);
check(
  "concert at 'Cafe du Nord' is not tagged Food & Drink",
  !cafeGig.includes("Food & Drink"),
  cafeGig.join(" + ")
);

// A concert that merely MENTIONS a bar — the user's own example.
const barGig = categorize(
  null,
  "Tobi Lou",
  "Doors at 7. Tobi Lou plays a set of new material with the band, seated, " +
    "with a full bar and food service available at the venue.",
  "Cafe du Nord"
);
check(
  "concert that mentions a bar is not tagged Food & Drink",
  !barGig.includes("Food & Drink"),
  barGig.join(" + ")
);

// A genuine food event must SURVIVE — the filter cannot become "never tag food".
const dinner = categorize(
  null,
  "Ferry Building Farmers Market Dinner",
  "A prix fixe dinner of the season's best produce, wine pairing included. " +
    "Seats are limited and reservations include a full wine tasting.",
  "Ferry Building"
);
check(
  "a real food event keeps Food & Drink",
  dinner.includes("Food & Drink"),
  dinner.join(" + ")
);

console.log("\n== tags: the cap ==");
check(
  "no event exceeds 2 tags",
  [rap, cafeGig, barGig, dinner].every((c) => c.length <= 2)
);

// Across the whole live feed, not just the fixtures.
const feed = JSON.parse(readFileSync(new URL("./events.json", DIR), "utf8"));
const over = feed.events.filter((e) => (e.categories || []).length > 2);
check(
  `published feed respects the cap (${feed.events.length} events)`,
  over.length === 0,
  over.slice(0, 3).map((e) => `${e.title}: ${e.categories.join("+")}`).join("; ")
);

console.log("\n== tags: always something, never empty or malformed ==");
check(
  "every event has 1-2 categories",
  feed.events.every((e) => e.categories && e.categories.length >= 1 && e.categories.length <= 2)
);
const known = new Set(Object.keys(CATEGORY_RANK));
check(
  "every category is a real category name",
  feed.events.every((e) => e.categories.every((c) => known.has(c))),
  feed.events.flatMap((e) => e.categories).filter((c) => !known.has(c)).slice(0, 3).join(", ")
);

console.log("\n== tags: no duplicate tags on one card ==");
check(
  "no repeats within a card",
  feed.events.every((e) => new Set(e.categories).size === e.categories.length)
);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);