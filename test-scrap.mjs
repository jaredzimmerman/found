// Unit tests for the SCRAP workshop parser.
//
// Every case below is a line copied verbatim from the live /workshops page
// (captured 2026-10-02). If the site's markup or wording changes, these fail
// loudly rather than letting the source quietly return zero rows — which is how
// a broken venue index produces a clean-looking log and a short feed.

import assert from "node:assert";
import { scrapLines, scrapBlock, scrapIsTitle, scrapIsKicker, SCRAP_VENUE, SCRAP_DATE_RX } from "./manual-venues.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

console.log("\nLine decode (the block-join trick)");
// The exact fragmentation Google Sites emits: "11:00" arrives as three spans.
const FRAGMENTED = `<body><div class="oKdM2c">
<h3><div class="CjVfdc"><div class="PPhIP"><span class="C9DxTc ">11</span><span class="C9DxTc ">:</span><span class="C9DxTc ">00 </span><span class="C9DxTc ">A</span><span class="C9DxTc "><span>M - 3:00 PM </span></span></div></div></h3>
<p><span class="C9DxTc ">A description long enough to be prose rather than a name or a clock time.</span></p>
</div></body>`;

t("spans inside one block are joined", () => {
  const l = scrapLines(FRAGMENTED);
  assert.deepStrictEqual(l[0], "11:00 AM - 3:00 PM");
});

t("each block element becomes exactly one line", () => {
  const l = scrapLines(FRAGMENTED);
  assert.strictEqual(l.length, 2, `expected 2 lines, got ${JSON.stringify(l)}`);
});

t("entities are decoded", () => {
  const l = scrapLines('<body><p><span class="C9DxTc ">&amp; &quot;x&quot;</span></p></body>');
  assert.strictEqual(l[0], '& "x"');
});

t("a page with no body still decodes", () => {
  const l = scrapLines("<p>Sunday, October 11</p>");
  assert.deepStrictEqual(l, ["Sunday, October 11"]);
});

console.log("\nDate anchors");
// Anchor on the line that actually parses as a date, not the first line that
// merely mentions a month — an earlier version keyed off /October/ and then
// picked a title as the anchor, which tested the wrong block.
const blockOf = (...lines) => {
  const i = lines.findIndex((l) => SCRAP_DATE_RX.test(l));
  assert.ok(i >= 0, `no date line in fixture: ${JSON.stringify(lines)}`);
  return scrapBlock(lines, i, 2026);
};

t("a dated line with a day-of-week anchors a block", () => {
  const b = blockOf("SCRAP STAFF-LED WORKSHOP", "Spellbound Bookmaking", "LaVera Wilson",
                    "Sunday, October 11", "11 AM - 1 PM");
  assert.strictEqual(b.date, "2026-10-11");
  assert.strictEqual(b.title, "Spellbound Bookmaking");
  assert.strictEqual(b.instructor, "LaVera Wilson");
});

t("a dated line with NO day-of-week also anchors", () => {
  const b = blockOf("Boroboro: Japanese Mending", "Dorothy Yuki", "Saturday, October 24", "11 AM - 2 PM");
  assert.strictEqual(b.date, "2026-10-24");
});

t("the date need not carry an ordinal", () => {
  const b = blockOf("Mending Patches", "Ana Ortiz", "Thursday, October 1", "5 PM - 8 PM");
  assert.strictEqual(b.date, "2026-10-01", "October 1 must zero-pad to 01");
});

t("the stated year is used, not the current one", () => {
  const b = blockOf("Immortal Clothes: Intro to Sewing", "Tira Connell", "Friday, February 5", "5 PM - 8 PM");
  assert.strictEqual(b.date, "2026-02-05");
});

t("a December date does not roll into next January", () => {
  const b = blockOf("Holiday Handprinting", "Dara Okafor", "Wednesday, December 30", "6 PM - 8 PM");
  assert.strictEqual(b.date, "2026-12-30");
});

console.log("\nTime");
t("a range becomes a normalised en-dash label", () => {
  const b = blockOf("Puppets", "Merritt Richmond", "Wednesday, October 21", "5 PM - 7 PM");
  assert.strictEqual(b.timeLabel, "5 PM–7 PM");
});

t("a lowercase range is normalised", () => {
  const b = blockOf("Spooktastic Accessories", "Authentic Skidmark", "Tuesday, October 20", "11am - 1pm");
  assert.strictEqual(b.timeLabel, "11 AM–1 PM");
});

t("a half-hour range keeps its minutes", () => {
  const b = blockOf("Light and Shadow", "Aiko Cuneo", "Tuesday, September 15", "5 PM - 7:30 PM");
  assert.strictEqual(b.timeLabel, "5 PM–7:30 PM");
});

t("a block with no stated time is Time TBA, not dropped", () => {
  const b = blockOf("Spellbound Bookmaking", "Sunday, October 11");
  assert.strictEqual(b.timeLabel, "Time TBA");
  assert.strictEqual(b.startMinutes, -1);
});

console.log("\nStatus");
t("SOLD OUT is detected and skipped", () => {
  const b = blockOf("Botanical Dyeing Witchery", "Catchweed Studio", "Thursday, October 29",
                    "5 PM - 8 PM", "SOLD OUT");
  assert.strictEqual(b.soldOut, true);
});

t("ONE SPOT LEFT is not sold out", () => {
  const b = blockOf("Boroboro: Japanese Mending", "Dorothy Yuki", "Saturday, October 24",
                    "11 AM - 2 PM", "ONE SPOT LEFT!");
  assert.strictEqual(b.soldOut, false);
});

t("a sold-out mention past the action link does not flag the block", () => {
  const b = blockOf("Boroboro: Japanese Mending", "Dorothy Yuki", "Saturday, October 24", "11 AM - 2 PM", "REGISTER HERE", "SOLD OUT");
  assert.strictEqual(b.soldOut, false, "the block already closed at REGISTER HERE");
});

console.log("\nTitle detection — the trap that loses workshops");
t("the kicker is never taken as the title", () => {
  assert.strictEqual(scrapIsKicker("SCRAP STAFF-LED WORKSHOP"), true);
  assert.strictEqual(scrapIsTitle("SCRAP STAFF-LED WORKSHOP"), true, "caps is not what disqualifies it");
});

t("a section header is never taken as the title", () => {
  assert.strictEqual(scrapIsTitle("PAST WORKSHOPS 2026"), false);
  assert.strictEqual(scrapIsTitle("WORKSHOPS 2026"), false);
});

t("a missing kicker still yields the real title", () => {
  const b = blockOf("Boroboro: Japanese Mending", "Dorothy Yuki", "Saturday, October 24", "11 AM - 2 PM");
  assert.strictEqual(b.title, "Boroboro: Japanese Mending");
});

t("body copy is not a title", () => {
  assert.strictEqual(scrapIsTitle("In this 2-hour hands-on workshop, you will learn hand stitchery techniques."), false);
});

t("a date is not a title", () => {
  assert.strictEqual(scrapIsTitle("Sunday, October 11"), false);
});

t("the instructor is not mistaken for the title", () => {
  const b = blockOf("SCRAP STAFF-LED WORKSHOP", "Puppets", "Merritt Richmond",
                    "Wednesday, October 21", "5 PM - 7 PM");
  assert.strictEqual(b.title, "Puppets");
  assert.strictEqual(b.instructor, "Merritt Richmond");
});

t("a block with no title above it returns null, not a guess", () => {
  const lines = ["Sunday, October 11", "11 AM - 1 PM"];
  assert.strictEqual(scrapBlock(lines, 0, 2026), null);
});

console.log("\nDescription");
t("the first prose line after the time is the description", () => {
  const b = blockOf("Spellbound Bookmaking", "LaVera Wilson", "Sunday, October 11", "11 AM - 1 PM",
                    "In Spellbound Bookmaking, learn to handcraft a spell book grimoire.",
                    "REGISTER HERE");
  assert.match(b.description, /spell book grimoire/);
});

t("a short status line is not mistaken for a description", () => {
  const b = blockOf("Boroboro: Japanese Mending", "Dorothy Yuki", "Saturday, October 24", "11 AM - 2 PM", "ONE SPOT LEFT!",
                    "Boroboro is a Japanese term for something that needs mending.");
  assert.match(b.description, /Japanese term/);
});

t("the description stops at the action link", () => {
  const b = blockOf("Spellbound Bookmaking", "LaVera Wilson", "Sunday, October 11", "11 AM - 1 PM", "REGISTER HERE",
                    "Some later body text that is not part of this workshop.");
  assert.strictEqual(b.description, "");
});

console.log("\nRegression: two live misfiles found 2026-10-02");
// Both were found by probes/scrap-live-check.mjs against the real page, and both
// had the same shape: the true title was rejected, leaving one name above the
// date, which filed the INSTRUCTOR as the title.

t("a series-numbered title is the title, not the instructor", () => {
  const b = blockOf("102: Pockets", "IMMORTAL CLOTHES WORKSHOP SERIES", "Tria Connell",
                    "Saturday, March 21", "11 AM - 1 PM");
  assert.strictEqual(b.title, "102: Pockets");
  assert.strictEqual(b.instructor, "Tria Connell");
});

t("a shouted series label between title and instructor is skipped", () => {
  const b = blockOf("Visible Mending: Patch your jeans by hand!", "Radha Weaver",
                    "Friday, September 25", "6 PM - 8 PM");
  assert.strictEqual(b.title, "Visible Mending: Patch your jeans by hand!");
  assert.strictEqual(b.instructor, "Radha Weaver");
});

t("the longest real title on the page is not rejected for length", () => {
  const title = "Maps as a Tool for Artistic Expression & Exploration of Visual Ideas";
  const b = blockOf(title, "Merritt Richmond", "Wednesday, April 15", "5 PM - 8 PM");
  assert.strictEqual(b.title, title);
});

t("a description that drifted into the title slot is not a title", () => {
  assert.strictEqual(scrapIsTitle("All materials provided. No experience necessary."), false);
  assert.strictEqual(scrapIsTitle("This workshop is supported by the San Francisco Arts Commission."), false);
});

t("a real title ending in a bang survives the sentence test", () => {
  assert.strictEqual(scrapIsTitle("Visible Mending: Patch your jeans by hand!"), true);
});

console.log("\nVenue identity");
t("the venue is the one the page is for", () => {
  assert.strictEqual(SCRAP_VENUE, "Scrap Creative Center");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
