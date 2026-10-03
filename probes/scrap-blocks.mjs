// Print the SCRAP workshop blocks as the parser sees them.
//
// The unit tests caught a structural error: reading upward from the date lands
// on the INSTRUCTOR line, not the title, because the instructor sits directly
// above the date. Before changing the rule I want to see every block on the
// live page — specifically whether the instructor line is ever absent, since
// that decides whether "two lines above" is a rule or a guess.
//
// Run: node probes/scrap-blocks.mjs /tmp/scrap.html

import { readFileSync } from "node:fs";
import { scrapLines, SCRAP_DATE_RX, SCRAP_SECTION_RX } from "../manual-venues.mjs";

const html = readFileSync(process.argv[2] || "/tmp/scrap.html", "utf8");
const lines = scrapLines(html);
console.log(`lines: ${lines.length}`);

// A kicker is shouted; a title and a person's name are not.
const isAllCaps = (s) => {
  const letters = [...s].filter((c) => /[a-z]/i.test(c));
  return letters.length > 0 && letters.every((c) => c === c.toUpperCase());
};

const dated = [];
lines.forEach((l, i) => { if (SCRAP_DATE_RX.test(l)) dated.push(i); });
console.log(`dated blocks: ${dated.length}\n`);

for (const i of dated.slice(0, 24)) {
  console.log(`--- date line ${i}: ${lines[i]}`);
  for (let j = Math.max(0, i - 4); j < i; j++) {
    console.log(`    [${isAllCaps(lines[j]) ? "KICKER" : "      "}] ${lines[j].slice(0, 86)}`);
  }
  console.log();
}

// How often is the instructor line missing? This is the number that decides
// whether the title is "the line two above the date" or "the nearest name".
let one = 0, two = 0;
for (const i of dated) {
  const above = [];
  for (let j = i - 1; j >= 0 && i - j <= 4; j--) {
    if (SCRAP_DATE_RX.test(lines[j]) || SCRAP_SECTION_RX.test(lines[j])) break;
    if (!isAllCaps(lines[j])) above.push(lines[j]);
  }
  if (above.length === 1) one++;
  else if (above.length >= 2) two++;
}
console.log(`blocks with exactly 1 non-caps line above the date: ${one}`);
console.log(`blocks with 2+ non-caps lines above the date:        ${two}`);
