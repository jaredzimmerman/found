// Test the title cleaner against the real feed, not hand-picked strings.
// The functions are imported from fetch.mjs so they are tested AS WRITTEN —
// an earlier version re-declared them here, which meant a passing test could
// coexist with a broken fetcher.
import { cleanTitle, isElsewhere, cleanDescription } from "./title-clean.mjs";
import { readFileSync } from "node:fs";

const feed = JSON.parse(readFileSync(new URL("./events.json", import.meta.url), "utf8"));
let ok = true;
const fail = (m) => { ok = false; console.log("  !! " + m); };

console.log("=== titles that CHANGE ===");
let changed = 0;
for (const e of feed.events) {
  const c = cleanTitle(e.title);
  if (c !== e.title) { changed++; console.log(`  ${e.title}\n    -> ${c}`); }
  if (!c) fail(`empty title from: ${e.title}`);
  if (/\(\s*(every|each|mon|tue|wed|thu|fri|sat|sun|weekend|daily)/i.test(c)) fail(`leftover schedule: ${c}`);
  if (/\(\s*(sf|s\.f\.|oakland|berkeley|santa rosa|redwood city|daly city|san jose|alameda|marin|sonoma)\s*\)/i.test(c)) fail(`leftover city: ${c}`);
}
console.log(`(${changed} of ${feed.events.length} changed)\n`);

console.log("=== must be KEPT intact ===");
for (const t of [
  "SF’s Noe Valley Night Market 2026",
  "Movie Party: Nacho Libre (with live trivia)",
  "Deathgasm 2: Goremageddon (R) ★",
  "SF Symphony: Beethoven's 9th (with the Youth Chorus)",
  "The History of Concrete (1970s, 16mm)",
  "Perfect Pairing | Wine & Watch: The Many Adventures of Winnie the Pooh",
]) {
  const c = cleanTitle(t);
  const good = c === t;
  if (!good) fail(`ate content: "${t}" -> "${c}"`);
  console.log(`  ${good ? "ok  " : "FAIL"} ${t}`);
}

console.log("\n=== edge cases: the year must not be eaten ===");
for (const [input, want] of [
  ["Takeover Wednesdays: Industry Night – DJ Mobando - September 30, 2026", "Takeover Wednesdays: Industry Night – DJ Mobando"],
  ["Bachata Party with JAS Latin Dance - Thursday, October 1, 2026", "Bachata Party with JAS Latin Dance"],
  ["SF’s Noe Valley Night Market 2026", "SF’s Noe Valley Night Market 2026"],
  ["Gala 2027 Preview", "Gala 2027 Preview"],
  ["Some Event - Oct 5", "Some Event - Oct 5"],
]) {
  const c = cleanTitle(input);
  const good = c === want;
  if (!good) fail(`"${input}" -> "${c}" (wanted "${want}")`);
  console.log(`  ${good ? "ok  " : "FAIL"} "${input}"\n       -> "${c}"`);
}

console.log("\n=== out-of-city dropped ===");
// Two separate claims. (1) The RULE must reject the KQED Santa Rosa and
// Redwood City listings — assert that directly against `isElsewhere`, with the
// real titles, since those rows are (correctly) absent from the feed and so
// cannot be tested by looking for them. (2) The FEED must contain nothing
// titled for another city. An earlier version asserted the KQED rows were
// present so it could watch them get dropped — which means it only passed
// while the bug was live, and failed once the drop worked.
for (const t of [
  "Rick Steves: How to See the World (Santa Rosa)",
  "Rick Steves: How to See the World (Redwood City)",
]) {
  const bad = !isElsewhere(t);
  if (bad) fail(`isElsewhere() failed to reject: ${t}`);
  console.log(`  ${bad ? "FAIL" : "ok  "} rule rejects  ${t}`);
}
const inFeed = feed.events.filter((e) => isElsewhere(e.title));
if (inFeed.length) fail(`feed still carries ${inFeed.length} out-of-city rows`);
console.log(`  ${inFeed.length ? "FAIL" : "ok  "} feed carries no out-of-city rows (${feed.events.length} checked)`);
// The KQED event itself is real and in-window; only its out-of-city dates go.
const kqed = feed.events.filter((e) => /kqed/i.test(e.url + (e.venue || "")));
console.log(`  info  KQED rows retained: ${kqed.length}${kqed.length ? " — " + kqed.map(e => e.title.slice(0, 30)).join("; ") : ""}`);

console.log("\n=== descriptions: dateline stripped ===");
for (const e of feed.events.slice(0, 4)) {
  console.log(`  ${e.title.slice(0, 30)}: "${cleanDescription(e.description).slice(0, 70)}"`);
}
for (const e of feed.events) {
  const c = cleanDescription(e.description);
  if (/\b(Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Monday),?\s+\w+\s+\d{1,2}\b/.test(c) && /\|/.test(c)) {
    fail(`dateline left in: "${c.slice(0, 90)}"`);
  }
}

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
