// destyle() removes text STYLING but must never remove TEXT. The failure mode
// is a name losing a character: `Hamdi**` ships with an orphaned closer, and a
// naive star-stripper deletes it as if it were a marker.
//
// Run: node test-destyle.mjs
import { destyle, strip, deemoji } from "./shared.mjs";

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
const D = destyle;

console.log("== real styling markers are removed ==");
check("bold pair at the head",
  D("**Steel Beans:** https://www.instagram.com/steelbeans/"),
  "Steel Beans: https://www.instagram.com/steelbeans/");
check("single-asterisk emphasis",
  D("The Castro's *only* monthly party"),
  "The Castro's only monthly party");
check("bold mid-sentence",
  D("Doors at 7. **Sold out.** Come early."),
  "Doors at 7. Sold out. Come early.");
check("backtick code span",
  D("Set `DEBUG=1` before running"),
  "Set DEBUG=1 before running");
check("two pairs in one string",
  D("**One** and *two*"),
  "One and two");

console.log("\n== text is NEVER eaten ==");
// The regression that matters: a bare name with an orphaned closing marker.
check("orphaned closer keeps the name intact",
  D("Hamdi**"),
  "Hamdi");
check("orphaned closer mid-line",
  D("SHINGO NAKAMURA + special guest **"),
  "SHINGO NAKAMURA + special guest");
check("unpaired leading bold is LEFT ALONE",
  // No closing pair, so this is not styling we can confidently read as
  // styling. Removing it could delete a literal character from a band name.
  // Leaving it is the reversible error; eating it is not.
  D("Chromeo + **Toro y Moi"),
  "Chromeo + **Toro y Moi");

console.log("\n== underscores are left alone ==");
// `_` is far more often a word character than an emphasis marker here.
check("snake_case preserved",
  D("Run with --flag_name value"),
  "Run with --flag_name value");
check("underscore inside a word preserved",
  D("artist_name appears here"),
  "artist_name appears here");
check("no invented emphasis",
  D("This _is_ not markup"),
  "This _is_ not markup");

console.log("\n== it composes with strip() ==");
check("strip removes html and styling together",
  strip("<p>**Bold** and <em>em</em> text</p>"),
  "Bold and em text");
check("strip does not eat a name",
  strip("Hamdi**"),
  "Hamdi");
check("strip is still bounded",
  strip("x".repeat(400)).length,
  240);

console.log("\n== ★ is content, not decoration ==");
// U+2605 shares a codepoint block with a fire and a party popper, so a broad
// "pictographs" range eats it. It is a film rating and it appears in artist
// names. An earlier fix to deemoji() split on the star and trimmed each
// segment, which deleted the space before it and printed "(R)★" — the star
// survived, the spacing did not.
check("star in a title keeps its space",
  deemoji("Deathgasm 2: Goremageddon (R) ★"),
  "Deathgasm 2: Goremageddon (R) ★");
check("star mid-string survives",
  deemoji("Two stars ★ and ★ here"),
  "Two stars ★ and ★ here");
check("star and emoji together",
  deemoji("Party \u{1F389} and film ★"),
  "Party and film ★");
check("lone star survives",
  deemoji("★"),
  "★");
check("emoji still removed around a star",
  deemoji("\u{1F389} show ★ tonight \u{1F389}"),
  "show ★ tonight");

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);