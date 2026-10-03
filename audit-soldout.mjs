// Does the sold-out detector over-match?
//
// The risk is specific: if the text fallback fires on a description that
// merely *mentions* sold out — a bar's promo copy, a neighbouring show — the
// page hides an event that is perfectly buyable. That failure is invisible in
// the count, so it has to be checked directly.

import fs from "node:fs";

const SRC = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/events.json";
const d = JSON.parse(fs.readFileSync(SRC, "utf8"));

const SOLD_OUT_RE =
  /\b(sold[\s‐-]?out|sell(?:ed)?[\s‐-]?out|out of stock|no (?:more )?(?:tickets|seats) (?:available|remaining)|at capacity|fully booked)\b/i;

// The exact string the fetcher tests: title + excerpt + description.
const blob = (e) => [e.title, e.description].join(" ");

const flagged = d.events.filter((e) => e.soldOut);
const byTextOnly = flagged.filter((e) => SOLD_OUT_RE.test(blob(e)));
const byApiOnly = flagged.filter((e) => !SOLD_OUT_RE.test(blob(e)));

console.log(`events: ${d.events.length}`);
console.log(`flagged sold out: ${flagged.length}`);
console.log(`  text regex matched: ${byTextOnly.length}`);
console.log(`  flag but no text match (API flag): ${byApiOnly.length}`);

console.log("\n-- every flagged row, with the evidence --");
for (const e of flagged) {
  const m = blob(e).match(SOLD_OUT_RE);
  const how = SOLD_OUT_RE.test(blob(e)) ? "text" : "api";
  console.log(`  [${how}] ${e.title}`);
  console.log(`         venue: ${e.venue}`);
  console.log(`         match: ${m ? JSON.stringify(m[0]) : "(from source flag)"}`);
}

// Counter-check: does the regex fire on any row we did NOT flag? If the
// fetcher's own decision disagrees with the regex, the two are out of sync.
const missed = d.events.filter((e) => !e.soldOut && SOLD_OUT_RE.test(blob(e)));
console.log(`\nrows where regex fires but not flagged: ${missed.length}`);
for (const e of missed.slice(0, 10)) {
  const m = blob(e).match(SOLD_OUT_RE);
  console.log(`  ${e.title}  <- "${m[0]}"`);
  console.log(`     ctx: ...${blob(e).slice(Math.max(0, m.index - 70), m.index + 70).replace(/\s+/g, " ")}...`);
}
