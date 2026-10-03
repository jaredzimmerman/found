// Inspect the two block shapes that made scrap-live-check misfile a title.
//
// scrap-live-check found "Tria Connell" filed as a TITLE with a null
// instructor. The suspected cause is a series label ("102: Pockets") sitting
// between the title and the date: it starts with a digit, and scrapIsTitle
// rejects anything not starting with a letter, so the two-name fallback fires
// and files the workshop under its teacher.
//
// This prints the surrounding lines for those anchors and counts how many
// series labels exist in that shape.
//
// Run: node probes/scrap-series.mjs /tmp/scrap.html

import { readFileSync } from "node:fs";
import { scrapLines, scrapIsTitle, SCRAP_DATE_RX } from "../manual-venues.mjs";

const lines = scrapLines(readFileSync(process.argv[2] || "/tmp/scrap.html", "utf8"));

const SERIES_RX = /^\d+\s*:\s*\S/;
const series = lines.filter((l) => SERIES_RX.test(l));
console.log(`\n=== series labels matching /^[0-9]+: Name/ : ${series.length}`);
for (const s of new Set(series)) console.log(`   ${s}   isTitle=${scrapIsTitle(s)}`);

console.log("\n=== blocks around the two misfiled anchors ===");
for (const want of ["Saturday, March 21", "Wednesday, April 15"]) {
  lines.forEach((l, i) => {
    if (l !== want) return;
    console.log(`\nANCHOR ${i}: ${l}`);
    for (let j = Math.max(0, i - 5); j <= i; j++) {
      console.log(`   [${j}] ${lines[j].slice(0, 78)}`);
    }
  });
}

// Which titles START with a digit — these are the ones the letter guard drops.
const digitTitled = [];
for (let i = 0; i < lines.length; i++) {
  if (!SCRAP_DATE_RX.test(lines[i])) continue;
  for (let j = i - 1; j >= 0 && i - j <= 3; j--) {
    if (/^[0-9]/.test(lines[j])) { digitTitled.push(lines[j]); break; }
    if (!scrapIsTitle(lines[j]) && !SCRAP_DATE_RX.test(lines[j])) break;
  }
}
console.log(`\n=== titles beginning with a digit: ${new Set(digitTitled).size}`);
for (const d of new Set(digitTitled)) console.log(`   ${d}`);
