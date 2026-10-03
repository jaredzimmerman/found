// Find a discriminator that separates a long TITLE from a long DESCRIPTION.
//
// Word count cannot: the longest real title is 11 words ("Maps as a Tool for
// Artistic Expression & Exploration of Visual Ideas") and descriptions run to
// 40+. A cap that admits the title also admits a short sentence, and a cap that
// rejects a short sentence rejects the title. Raising the cap to 12 fixed two
// live misfiles and broke the "body copy is not a title" case — the same test
// cannot serve both.
//
// Candidates, measured against the live page rather than guessed:
//   A. sentence-final punctuation (a description ends with '.')
//   B. a lowercase function word ('you', 'will', 'the', 'and')
//   C. Title Case throughout
//
// Prints, for each of the two populations, how many rows each rule accepts.
//
// Run: node probes/scrap-titleshape.mjs /tmp/scrap.html

import { readFileSync } from "node:fs";
import { scrapLines, scrapIsTitle, scrapIsKicker, SCRAP_DATE_RX, SCRAP_SECTION_RX } from "../manual-venues.mjs";

const lines = scrapLines(readFileSync(process.argv[2] || "/tmp/scrap.html", "utf8"));

const TITLES = [
  "Maps as a Tool for Artistic Expression & Exploration of Visual Ideas",
  "102: Pockets", "Spellbound Bookmaking", "Puppets",
  "Boroboro: Japanese Mending", "Korean Bojagi", "Tatreez Circle",
  "Spooky Scary Assemblage: Mary Shelley's Monster",
];
const DESCS = [
  "In this 2-hour hands-on workshop, you will learn hand stitchery techniques.",
  "Making quilt blocks does not have to be precision sewing! Open up to improvisa",
  "All ages are welcome, no special bookbinding experience necessary.",
  "Open to beginners and beyond: as long as you can sew a straight-ish stitch, yo",
  "In Spellbound Bookmaking, learn to handcraft a spell book grimoire.",
];

const endsPunct = (s) => /[.!?]$/.test(s.trim());
const hasLowerFn = (s) => /\b(?:you|your|will|learn|the|and|with|this|that|from|for|are|can|we|our)\b/i.test(s);
const titleCase = (s) => {
  const words = s.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  const lower = words.filter((w) => /^[a-z]/.test(w));
  return lower.length / Math.max(1, words.length);
};

console.log("\nrule              titles-accepted / 8      descs-accepted / 5");
for (const [label, fn] of [["ends with .!?", endsPunct], ["lowercase fn word", hasLowerFn], ["title-case ratio < 0.2", (s) => titleCase(s) < 0.2]]) {
  const t = TITLES.filter(fn).length, d = DESCS.filter(fn).length;
  console.log(`${label.padEnd(18)}${String(t + "/" + TITLES.length).padEnd(26)}${d + "/" + DESCS.length}`);
}

// The real populations, straight off the page: what sits directly above the
// instructor slot vs what sits after the time.
console.log("\n=== title lines on the live page: do any end with punctuation? ===");
let year = new Date().getFullYear();
const realTitles = [];
for (let i = 0; i < lines.length; i++) {
  const sec = lines[i].match(SCRAP_SECTION_RX);
  if (sec) { year = Number(sec[1]); continue; }
  if (!SCRAP_DATE_RX.test(lines[i])) continue;
  const names = [];
  for (let j = i - 1; j >= 0 && i - j <= 3; j--) {
    if (SCRAP_DATE_RX.test(lines[j]) || SCRAP_SECTION_RX.test(lines[j])) break;
    if (scrapIsKicker(lines[j])) continue;
    if (scrapIsTitle(lines[j])) names.push(lines[j]);
  }
  if (names.length >= 2) realTitles.push(names[1]);
}
const punct = realTitles.filter(endsPunct);
console.log(`titles: ${realTitles.length}   ending in .!?: ${punct.length}`);
for (const p of punct) console.log(`   ${p}`);

const longest = [...realTitles].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length).slice(0, 6);
console.log("\nlongest real titles:");
for (const l of longest) {
  console.log(`   ${String(l.split(/\s+/).length).padStart(2)}w  endsPunct=${String(endsPunct(l)).padEnd(5)} lowerFn=${String(hasLowerFn(l)).padEnd(5)}  ${l.slice(0, 62)}`);
}
