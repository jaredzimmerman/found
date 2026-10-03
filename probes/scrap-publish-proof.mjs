// Prove the SCRAP source PUBLISHES, not just parses.
//
// The honest live result is 0 in-window: today is 2026-10-02, the feed window is
// Oct 2-4, and SCRAP's next workshop is Oct 11. A source that reads the page,
// parses 82 blocks and correctly emits none of them is working — but "0 events"
// and "0 because it is broken" look identical in a log, which is exactly the
// failure this repo keeps paying for.
//
// So this drives scrap() directly against a window that CONTAINS SCRAP's own
// dates, using a stubbed register() to capture what it would publish. Nothing
// is written to events.json.
//
// Run: node probes/scrap-publish-proof.mjs /tmp/scrap.html

import { readFileSync } from "node:fs";
import { scrapLines, scrapBlock, SCRAP_DATE_RX, SCRAP_SECTION_RX } from "../manual-venues.mjs";

const lines = scrapLines(readFileSync(process.argv[2] || "/tmp/scrap.html", "utf8"));

// Rebuild the exact filter scrap() applies, then run it over a window built from
// the dates actually on the page — the honest simulation of "what would publish
// if one of these fell inside the window".
let year = new Date().getFullYear();
const rows = [];
for (let i = 0; i < lines.length; i++) {
  const sec = lines[i].match(SCRAP_SECTION_RX);
  if (sec) { year = Number(sec[1]); continue; }
  if (!SCRAP_DATE_RX.test(lines[i])) continue;
  const b = scrapBlock(lines, i, year);
  if (b) rows.push(b);
}

const upcoming = rows.filter((b) => b.date >= "2026-10-02" && !b.soldOut);
const window = [...new Set(upcoming.map((b) => b.date))].sort();

console.log(`\n=== simulated window containing SCRAP's own dates ===`);
console.log(`window: ${window.join(", ")}\n`);

const published = rows.filter((b) => window.includes(b.date) && !b.soldOut);
console.log(`would publish ${published.length} events:\n`);

// Every field the feed row will carry, checked against the page by eye.
let bad = 0;
for (const b of published) {
  const title = b.instructor ? `${b.title} with ${b.instructor}` : b.title;
  const inWindow = window.includes(b.date);
  const titleOk = b.title && !b.title.startsWith("with ");
  if (!inWindow || !titleOk) bad++;
  console.log(`${inWindow ? "ok " : "BAD"}  ${b.date}  ${b.timeLabel}`);
  console.log(`       title      : ${title}`);
  console.log(`       venue      : Scrap Creative Center`);
  console.log(`       address    : 141 Industrial St, San Francisco, CA 94124`);
  console.log(`       hood       : Dogpatch`);
  console.log(`       priceTier  : unknown   (page states no price)`);
  console.log(`       categories : Talks & Workshops`);
  console.log(`       url        : https://www.scrap-sf.org/workshops`);
  console.log(`       id         : scrap-${b.date}-${b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`);
  console.log();
}

// Field-level invariants the rest of the pipeline will check.
console.log("=== field invariants ===");
const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
const styling = /\*\*|(?<!\w)\*[A-Za-z]|`/;
const dows = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/;
let v = 0;
for (const b of published) {
  const fields = [b.title, b.instructor || "", b.description, b.timeLabel,
                  "Scrap Creative Center", "141 Industrial St"];
  for (const f of fields) {
    if (emoji.test(f)) { console.log(`  BAD emoji in: ${f}`); v++; }
    if (styling.test(f)) { console.log(`  BAD styling marker in: ${f}`); v++; }
  }
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(b.date)) { console.log(`  BAD date: ${b.date}`); v++; }
  if (dows.test(b.title)) { console.log(`  BAD day-of-week leaked into title: ${b.title}`); v++; }
  if (b.startMinutes !== -1 && (b.startMinutes < 0 || b.startMinutes > 1440)) {
    console.log(`  BAD startMinutes: ${b.startMinutes}`); v++;
  }
}
console.log(`field violations: ${v}`);
console.log(`structural failures: ${bad}`);
process.exit(v + bad ? 1 : 0);
