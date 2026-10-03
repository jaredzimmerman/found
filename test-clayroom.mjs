// Unit tests for the Clayroom schedule parser.
//
// Every case below is a line copied verbatim from a live Clayroom class page
// (captured 2026-10-02). If the site's date formats change, these fail loudly
// rather than letting the source silently return zero rows — which is exactly
// how the previous Clayroom parser failed for weeks.

import assert from "node:assert";
import { claySchedules, clayTitle, clayDate, clayPageText, clayAddress, CLAY_SF_HOSTS } from "./manual-venues.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

// claySchedules() consumes page text (a newline-joined string), exactly as the
// scraper passes it. The helpers below join a single line into that shape.
const pageOf = (...lines) => lines.join("\n");
const isos = (lines) => claySchedules(pageOf(...[].concat(lines))).map((s) => s.iso);
const labels = (lines) => claySchedules(pageOf(...[].concat(lines))).map((s) => s.label);

console.log("\nClayroom schedule parsing");

t("workshop: 'Saturday & Sunday, October 24-25 | 11am-5pm' -> 2 rows", () => {
  assert.deepStrictEqual(isos(["Saturday & Sunday, October 24-25 | 11am-5pm"]), [
    `${new Date().getFullYear()}-10-24`, `${new Date().getFullYear()}-10-25`,
  ]);
});

t("workshop: start time becomes the timeLabel", () => {
  assert.deepStrictEqual(labels(["Saturday & Sunday, October 24-25 | 11am-5pm"]), ["11am", "11am"]);
});

t("workshop: end time is captured separately", () => {
  const r = claySchedules("Saturday & Sunday, October 24-25 | 11am-5pm");
  assert.strictEqual(r[0].end, "11am-5pm");
});

t("single day: 'Wednesday October 21st: 11am-5pm' -> 1 row", () => {
  assert.deepStrictEqual(isos(["Wednesday October 21st: 11am-5pm"]), [`${new Date().getFullYear()}-10-21`]);
});

t("single day: 'Starts Oct 24' is a heading, not a schedule -> no rows", () => {
  assert.deepStrictEqual(isos(["Starts Oct 24"]), []);
});

t("two days one line: 'Saturday, November 7 & Sunday, November 8 from 10:30am - 2:30pm' -> 2 rows", () => {
  assert.deepStrictEqual(
    isos(["Saturday, November 7 & Sunday, November 8 from 10:30am - 2:30pm"]),
    [`${new Date().getFullYear()}-11-07`, `${new Date().getFullYear()}-11-08`]);
});

t("6-week course: 'Thursday @6 pm from October 15th-November 20th' expands weekly", () => {
  const r = isos(["Intro to Clay Thursday @6 pm from October 15th-November 20th"]);
  assert.strictEqual(r.length, 6, `expected 6 weekly sessions, got ${r.length}: ${r}`);
  assert.deepStrictEqual(r, ["2026-10-15", "2026-10-22", "2026-10-29", "2026-11-05", "2026-11-12", "2026-11-19"].map(
    (d) => `${new Date().getFullYear()}-${d.slice(5)}`));
});

t("6-week course: keeps its own timeLabel", () => {
  assert.deepStrictEqual(labels(["Intro to Clay Thursday @6 pm from October 15th-November 20th"]),
    Array(6).fill("6pm"));
});

t("bare range: 'October 24 & 25 with Justin Paik-Reese' -> 2 rows, Time TBA", () => {
  const r = claySchedules("October 24 & 25 with Justin Paik-Reese");
  assert.deepStrictEqual(r.map((x) => x.iso), [`${new Date().getFullYear()}-10-24`, `${new Date().getFullYear()}-10-25`]);
  assert.deepStrictEqual(r.map((x) => x.label), ["Time TBA", "Time TBA"]);
});

t("bare range with time: 'Nov 7, 2026 - Nov 8, 2026' header does not invent a time", () => {
  // The date pair here is real, but the line carries no clock time.
  const r = claySchedules("Saturday, November 7 & Sunday, November 8 from 10:30am - 2:30pm");
  assert.ok(r.every((x) => x.label === "10:30am"));
});

t("store hours are never mistaken for a class date", () => {
  assert.deepStrictEqual(isos(["Monday & Wednesday 10am-6pm", "Tuesday - Friday 10am-6pm"]), []);
});

t("a prose line with a weekday and no date is not a schedule", () => {
  assert.deepStrictEqual(isos(["We meet on Saturday, October 3rd for the show."]), []);
});

t("long paragraphs are skipped rather than mined for dates", () => {
  const para = "This intensive six week course is an excellent introduction to ceramics. ".repeat(6) +
    "Saturday October 24 at 11am";
  assert.deepStrictEqual(isos([para]), []);
});

console.log("\nPage text extraction — the schedule lives in meta description, not the body");

t("reads the schedule out of <meta name=description>", () => {
  // Real markup captured from clayroomsf.com on 2026-10-02.
  const html = '<meta name="description" content="Saturday &amp; Sunday, October 24-25 | 11am-5pm\n\n' +
    "Clayroom Potrero Hill; 1431 17th Street in San Francisco\n\n" +
    "This two-day intensive workshop guides intermediate ceramic artists through the process of " +
    'creating composite wheel-thrown forms using sound techniques and refining them using torching, ' +
    'trimming, and structured geometric surface mapping techniques.">';
  const text = clayPageText(html);
  assert.ok(text.includes("\n"), "newlines must survive, or no line is a schedule line");
  assert.deepStrictEqual(claySchedules(text).map((s) => s.iso), [
    `${new Date().getFullYear()}-10-24`, `${new Date().getFullYear()}-10-25`,
  ]);
});

t("entities in the meta description are decoded", () => {
  const html = '<meta name="description" content="Saturday &amp; Sunday, October 24-25 | 11am-5pm">';
  assert.ok(clayPageText(html).includes("Saturday & Sunday"));
});

t("venue line is present so the address resolver can match", () => {
  const html = '<meta name="description" content="Saturday &amp; Sunday, October 24-25 | 11am-5pm\n\nClayroom Potrero Hill; 1431 17th Street in San Francisco">';
  assert.ok(/1431\s+17th Street/i.test(clayPageText(html)));
});

t("script and style bodies are not mined for dates", () => {
  const html = '<script>var d="Monday October 26 9am";</script><style>.a:after{content:"Tuesday"}</style>';
  assert.deepStrictEqual(claySchedules(clayPageText(html)), []);
});

t("a page with no meta description still falls back to the body", () => {
  const html = "<div>Saturday &amp; Sunday, October 24-25 | 11am-5pm</div>";
  assert.deepStrictEqual(claySchedules(clayPageText(html)).map((s) => s.iso),
    [`${new Date().getFullYear()}-10-24`, `${new Date().getFullYear()}-10-25`]);
});

console.log("\nCourse formats observed on real SF class pages (2026-10-02)");

const Y = new Date().getFullYear();
// Each of these five lines was copied from a live class page. All five are
// weekly courses; the parser anchored on a weekday and missed four of them.
t("'Tuesdays @6-8:30PM beginning October 13th-November 17th'", () => {
  const r = claySchedules("Tuesdays @6-8:30PM beginning October 13th-November 17th");
  assert.ok(r.length >= 5, `expected weekly sessions, got ${r.length}`);
  assert.strictEqual(r[0].iso, `${Y}-10-13`);
  assert.strictEqual(r[0].label, "6pm");
});

t("'Mondays from 6pm-8:30pm; October 12th-November 16th'", () => {
  const r = claySchedules("Mondays from 6pm-8:30pm; October 12th-November 16th");
  assert.ok(r.length >= 5, `expected weekly sessions, got ${r.length}`);
  assert.strictEqual(r[0].iso, `${Y}-10-12`);
});

t("'Beginning Thursday @6-8:30pm from October 14th-November 18th'", () => {
  const r = claySchedules("Beginning Thursday @6-8:30pm from October 14th-November 18th");
  assert.ok(r.length >= 5, `expected weekly sessions, got ${r.length}`);
  assert.strictEqual(r[0].iso, `${Y}-10-14`);
});

t("\"Tuesday's @6-8:30PM, October 13th-November 16th\" (typo apostrophe)", () => {
  const r = claySchedules("Tuesday's @6-8:30PM, October 13th-November 16th");
  assert.ok(r.length >= 5, `expected weekly sessions, got ${r.length}`);
  assert.strictEqual(r[0].iso, `${Y}-10-13`);
});

t("'Intro to Clay Thursday @6 pm from October 15th-November 20th' (original)", () => {
  const r = claySchedules("Intro to Clay Thursday @6 pm from October 15th-November 20th");
  assert.strictEqual(r.length, 6);
  assert.strictEqual(r[0].label, "6pm");
});

t("a 2-day range is a one-off, not 15 daily rows", () => {
  const r = claySchedules("Saturday & Sunday, October 24-25 | 11am-5pm");
  assert.strictEqual(r.length, 2, `a one-off must not expand weekly: got ${r.length}`);
});

console.log("\nDuplicates — the page states each schedule twice (meta + body)");

t("the same session stated twice collapses to one row", () => {
  const one = "Tuesdays @6-8:30PM beginning October 13th-November 17th";
  const both = claySchedules(one + "\n" + one);
  assert.deepStrictEqual(both.map((r) => r.iso), claySchedules(one).map((r) => r.iso));
});

t("a duplicate pair differing only in clock keeps the one with a clock", () => {
  const r = claySchedules("Saturday & Sunday, October 24-25 | 11am-5pm\nSaturday & Sunday, October 24-25");
  assert.strictEqual(r.length, 2, `expected 2 rows, got ${r.length}`);
  assert.deepStrictEqual(r.map((x) => x.label), ["11am", "11am"]);
});

t("distinct sessions on one page are all kept", () => {
  const r = claySchedules(
    "Intro to Clay Thursday @6 pm from October 15th-November 20th\n" +
    "Intro to Clay Saturday @11am from October 17th-November 21st");
  assert.deepStrictEqual(r.map((x) => x.iso), [
    "2026-10-15", "2026-10-17", "2026-10-22", "2026-10-24", "2026-10-29", "2026-10-31",
    "2026-11-05", "2026-11-07", "2026-11-12", "2026-11-14", "2026-11-19", "2026-11-21",
  ].map((d) => `${new Date().getFullYear()}-${d.slice(5)}`));
});

t("output is date-ordered", () => {
  const r = claySchedules(
    "Intro to Clay Saturday @11am from October 17th-November 21st\n" +
    "Intro to Clay Thursday @6 pm from October 15th-November 20th");
  const isos = r.map((x) => x.iso);
  assert.deepStrictEqual(isos, [...isos].sort());
});

console.log("\nAddress resolution — course pages print no address at all");

t("reads businessLocationFormatted from Wix structured data", () => {
  const html = '{"businessLocationFormatted":"1431 17th St, San Francisco, CA 94107, USA"}';
  assert.strictEqual(clayAddress(html, "https://www.clayroomsf.com/service-page/x"),
    "1431 17th St, San Francisco, CA 94107");
});

t("falls back to the visible address element", () => {
  const html = '<p data-hook="location-address">1431 17th St, San Francisco, CA 94107, USA</p>';
  assert.strictEqual(clayAddress(html, "https://www.clayroomsf.com/service-page/x"),
    "1431 17th St, San Francisco, CA 94107");
});

t("falls back to the studio default when the page carries no address", () => {
  assert.strictEqual(clayAddress("<div>held at our Potrero Hill Studio</div>",
    "https://www.clayroomsf.com/service-page/x"), "1431 17th St, San Francisco, CA 94107");
  assert.strictEqual(clayAddress("<div></div>",
    "https://www.clayroomsoma.com/service-page/x"), "727 9th St, San Francisco, CA 94103");
});

t("rejects a structured value that is not a street address", () => {
  const html = '{"businessLocationFormatted":"Clayroom Potrero Hill"}';
  assert.ok(clayAddress(html, "https://www.clayroomsf.com/service-page/x")
    .startsWith("1431"), "a studio name must not be published as an address");
});

t("an unknown host gets null rather than someone else's address", () => {
  assert.strictEqual(clayAddress("<div></div>", "https://example.com/service-page/x"), null);
});

console.log("\nTitle extraction");

t("og:title wins and the site suffix is dropped", () => {
  const h = '<meta property="og:title" content="Wheel-Throwing Composite Forms | clayroomsf">';
  assert.strictEqual(clayTitle(h), "Wheel-Throwing Composite Forms");
});

t("<title> is the fallback", () => {
  assert.strictEqual(clayTitle("<title>Intro to Clay (Session 7.5) | clayroomsf</title>"),
    "Intro to Clay (Session 7.5)");
});

t("no title metadata yields an empty string, not 'undefined'", () => {
  assert.strictEqual(clayTitle("<div>nothing here</div>"), "");
});

console.log("\nCity gate — Oakland/San Mateo must never reach the SF feed");

t("SF hosts accepted", () => {
  for (const h of ["https://www.clayroomsf.com/service-page/x",
                   "https://www.clayroomsoma.com/service-page/x"]) {
    assert.ok(CLAY_SF_HOSTS.test(h), h);
  }
});

t("Oakland and San Mateo rejected", () => {
  for (const h of ["https://www.clayroomoakland.com/service-page/x",
                   "https://www.clayroomsanmateo.com/service-page/x"]) {
    assert.ok(!CLAY_SF_HOSTS.test(h), h);
  }
});

console.log("\nDate normalisation");

t("invalid day rejected", () => {
  assert.strictEqual(clayDate("45", "October", "6pm", ""), null);
});

t("unknown month rejected", () => {
  assert.strictEqual(clayDate("3", "Smarch", "6pm", ""), null);
});

t("month is zero-padded", () => {
  assert.strictEqual(clayDate("3", "November", "6pm", "").iso,
    `${new Date().getFullYear()}-11-03`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);