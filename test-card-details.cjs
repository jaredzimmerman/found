// Card-level defects that are invisible to a "does the card exist" check.
//
// Both of these were live on the site while every structural test passed:
//
//   1. `.tag` carried `margin:-5.5px -4px` — a hit-area expansion applied to all
//      four sides. The horizontal half pulled every category chip 4px LEFT of
//      the text column, so the chips on all 148 cards hung outside the margin
//      that the time, title and description set. The eye judges the page margin
//      off the leftmost ink, and the chips were the leftmost ink.
//
//   2. `.figure-link` — the anchor wrapping every card photo — had no colour
//      reset. It wraps an image, so it has no text to inherit a colour from, and
//      the UA default survived: 124 anchors in link blue with an underline, which
//      is also why the audit saw them as 190px-tall `Times` boxes.
//
// Neither is a layout bug. Both are "the element is there and it is the right
// size" bugs, which is the class a bounding-box check cannot catch.
const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const URL = "https://datebook.indigokarasu.com/";

let fails = 0;
const check = (label, ok, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
};

(async () => {
  const b = await pw.chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox"] });
  const p = await b.newPage({ viewport: { width: 1185, height: 820 } });
  await p.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
  await p.waitForTimeout(2500);

  const r = await p.evaluate(() => {
    // The text column's left edge, taken from the time — the leftmost thing that
    // is supposed to define the margin.
    const colX = document.querySelector(".row .time-col").getBoundingClientRect().x;

    // 1. the FIRST tag chip in every row (the one that defines the margin).
    //    Alignment is asserted in test-tag-spacing.cjs, which measures the chip's
    //    visible BORDER rather than its hit-area box; not re-asserted here.

    // 2. anchors that kept the UA's default link styling
    const blueLinks = [...document.querySelectorAll("a")].filter((a) => {
      const s = getComputedStyle(a);
      return s.color === "rgb(0, 0, 238)" || s.textDecorationLine.includes("underline");
    }).length;
    const figLinks = document.querySelectorAll("a.figure-link").length;

    // 3. a regression guard on the thing the fix must NOT break: the tag is
    // still a comfortable click target vertically.
    const tag = document.querySelector(".row .tag");
    const th = tag ? +tag.getBoundingClientRect().height.toFixed(1) : 0;

    return {
      colX, tagCount: document.querySelectorAll(".row .tag").length,
      blueLinks, figLinks, tagH: th,
    };
  });

  console.log("\n== the chips exist and are real boxes ==");
  check("there are tags to measure", r.tagCount > 0, `${r.tagCount} tags`);

  console.log("\n== the photo link is a link target, not a blue link ==");
  check("photo links exist", r.figLinks > 0, `${r.figLinks} anchors`);
  check("no anchor kept the UA's blue/underline", r.blueLinks === 0, `${r.blueLinks} unstyled`);

  console.log("\n== the tag is still big enough to click ==");
  check("tag height is at least 20px", r.tagH >= 20, `${r.tagH}px`);

  await b.close();
  console.log(fails ? `\n${fails} FAILING` : "\nPASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });