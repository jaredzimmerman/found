// The dateline tail is the single most destructive regex in this pipeline: it
// deletes text. It has now been wrong in BOTH directions across one session —
// too tight (Salam Mami shipped a raw blob with address and phone) and, after
// the first fix, too loose ("We meet on Saturday, October 3rd for the show."
// became "We meet on"). Every attempt to fix it by gating on the PRECEDING
// token failed one way or the other; the discriminator is the data-like tail.
//
// Run: node test-dateline.mjs
import { cleanDescription } from "./title-clean.mjs";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  if (got === want) { pass++; console.log(`  ok    ${name}`); }
  else {
    fail++;
    console.log(`  FAIL  ${name}`);
    console.log(`          want ${JSON.stringify(want)}`);
    console.log(`          got  ${JSON.stringify(got)}`);
  }
};
const run = (s) => cleanDescription(s, "Temple");

console.log("== dateline tails are STRIPPED ==");
// Each of these shipped at some point with the tail still attached.
check("pipe + venue",
  run("R-Evolution Friday, October 2 | Embarcadero Plaza Arts"),
  "R-Evolution");
check("year + doors + time + age",
  run("Kit Clayton Friday, October 2, 2026 Doors 7:00PM 21+"),
  "Kit Clayton");
check("pipe + venue (2)",
  run("Heather McDonald Friday, October 2 | Cobb's Comedy"),
  "Heather McDonald");
check("full date then EOS",
  run("Doors at 7 Saturday, October 3, 2026"),
  "Doors at 7");
check("the shipped SALAM MAMI blob",
  run("Join us Saturday, October 3 Doors 10PM Temple SF | 540 Howard St"),
  "Join us");
check("dateline after a sentence break",
  run("Music. Saturday, October 3, 2026 | The Midway"),
  // The sentence-ending period belongs to the sentence we are keeping, so it
  // stays. Trailing punctuation is not a defect; losing the clause is.
  "Music.");

console.log("\n== real prose is KEPT ==");
// These are the sentences an over-loose tail destroyed.
check("prose with a date and a purpose clause",
  run("We meet on Saturday, October 3rd for the show."),
  "We meet on Saturday, October 3rd for the show.");
check("date followed by a price",
  run("Join us Saturday, October 3! Free."),
  "Join us Saturday, October 3! Free.");
check("appositive after the date",
  run("Come celebrate with us, Saturday, October 3! Bring friends."),
  "Come celebrate with us, Saturday, October 3! Bring friends.");
check("recurring-day prose",
  run("Every Saturday, October 3! Come early."),
  "Every Saturday, October 3! Come early.");
check("date mid-sentence, prose after the period",
  run("The show is Saturday, October 3, 2026. Free for all."),
  "The show is Saturday, October 3, 2026. Free for all.");
check("a date RANGE inside real prose",
  // Shipped in the feed and flagged by the scan: "…Golden Gate Park from
  // Friday, October 2, to Sunday, October 4. Now in its 26th year…". No pipe,
  // no data token, and the date does not reach end-of-string, so this is
  // prose and must survive whole.
  run("The festival returns to Golden Gate Park from Friday, October 2, to Sunday, October 4. Now in its 26th year, the free festival presents a bill."),
  "The festival returns to Golden Gate Park from Friday, October 2, to Sunday, October 4. Now in its 26th year, the free festival presents a bill.");

console.log("\n== a real description is never reduced to nothing ==");
// The failure mode that matters most: prose vanishing entirely.
for (const s of [
  "We meet on Saturday, October 3rd for the show.",
  "Join us Saturday, October 3! Free.",
  "Every Saturday, October 3! Come early.",
]) {
  const out = run(s);
  const kept = out.length >= s.length - 2;
  if (kept) { pass++; console.log(`  ok    survived intact: "${s.slice(0, 40)}..."`); }
  else {
    fail++;
    console.log(`  FAIL  lost ${s.length - out.length} chars: "${s.slice(0, 40)}..."`);
  }
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);