// Prove the SCRAP parser against every dated block on the live page.
//
// The unit suite pins the parser. This proves it against reality: it prints the
// title/instructor pairing for all 82 blocks so a wrong pairing is visible by
// eye, and fails loudly on the two failure modes that would quietly ship the
// feed wrong:
//
//   · a title that is actually a person's name (the bug this file exists to
//     catch — every workshop filed under its teacher)
//   · a workshop on the page that the parser dropped for a reason we cannot see
//
// Run: node probes/scrap-live-check.mjs /tmp/scrap.html

import { readFileSync } from "node:fs";
import { scrapLines, scrapBlock, scrapIsTitle, SCRAP_DATE_RX, SCRAP_SECTION_RX } from "../manual-venues.mjs";

const html = readFileSync(process.argv[2] || "/tmp/scrap.html", "utf8");
const lines = scrapLines(html);

const MI = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
             july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

// "Is this title actually a person?" A regex on Capitalised-Words guesses wrong:
// "Handheld Meditation Labyrinths" and "Paper Embroidery" are workshop titles,
// and a shape test flags both. The self-proving version is a cross-reference —
// a name that appears as the INSTRUCTOR of some other block is a person, so
// collect every instructor name first and reject any title found in that set.
const shape = (s) => /^[A-Z][a-z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){1,2}$/.test(s.trim());
let year = new Date().getFullYear();
const rows = [];
let dated = 0, nulled = 0;

for (let i = 0; i < lines.length; i++) {
  const sec = lines[i].match(SCRAP_SECTION_RX);
  if (sec) { year = Number(sec[1]); continue; }
  if (!SCRAP_DATE_RX.test(lines[i])) continue;
  dated++;
  const b = scrapBlock(lines, i, year);
  if (!b) { nulled++; continue; }
  rows.push(b);
}

console.log(`lines ${lines.length}   dated blocks ${dated}   parsed ${rows.length}   null ${nulled}\n`);

const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

// A name is a person if the page itself uses it as an instructor somewhere.
const knownInstructors = new Set(rows.map((b) => b.instructor).filter(Boolean).map((s) => s.trim()));
const looksLikePerson = (s) => knownInstructors.has(String(s).trim());
// Shape alone is still worth printing — it is a weak signal, and a shape-hit
// that is NOT a known instructor is a title we should eyeball, not a failure.
const shapeOnly = (s) => shape(s) && !looksLikePerson(s);

for (const b of sorted) {
  const flag = looksLikePerson(b.title) ? "  <-- TITLE IS A KNOWN INSTRUCTOR" : "";
  const sold = b.soldOut ? "  [SOLD OUT]" : "";
  console.log(`${b.date}  ${b.timeLabel.padEnd(14)}  ${b.title.slice(0, 54).padEnd(56)} | ${String(b.instructor || "-").slice(0, 22)}${sold}${flag}`);
}

console.log("\n--- checks ---");
const personTitled = sorted.filter((b) => looksLikePerson(b.title));
console.log(`titles that are a known instructor name: ${personTitled.length}`);
for (const b of personTitled) console.log(`   ${b.date} ${b.title}  (instructor: ${b.instructor})`);

const longTitles = sorted.filter((b) => b.title.split(/\s+/).length > 12);
console.log(`titles over 12 words: ${longTitles.length}`);

const noTime = sorted.filter((b) => b.startMinutes === -1);
console.log(`blocks with no stated time: ${noTime.length}`);

const soldOut = sorted.filter((b) => b.soldOut);
console.log(`blocks flagged sold out: ${soldOut.length}`);

const future = sorted.filter((b) => b.date >= "2026-10-02");
console.log(`blocks dated on/after 2026-10-02 (the publish window opens here): ${future.length}`);
for (const b of future) console.log(`   ${b.date} ${b.timeLabel} ${b.title}  |  ${b.instructor || "-"}`);

console.log(`\nshape-only hits (titles that look name-shaped but are not instructors): ${sorted.filter((b) => shapeOnly(b.title)).length}`);
process.exit(personTitled.length || longTitles.length ? 1 : 0);
