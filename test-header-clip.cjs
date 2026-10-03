// Is the wordmark CLIPPED, and does the bar's row spacing hold up?
//
// Both of these were broken at once and neither was visible to the existing
// suites, because "does the wordmark exist" and "does the bar have a gap" were
// both still true while the thing on screen was wrong:
//
//   * The wordmark was cut to "FOG & FOI". `measureBrand()` measured a CLONE
//     appended to `document.body`, which is not inside a `.fbar-top`, so the
//     descendant selector `.fbar-top .brand b` never matched it and the clone
//     inherited 16px Archivo instead of 22px Playfair. It reported 113px for a
//     name that needs 155px, and the `overflow:hidden` box turned that into a
//     visible cut. A Range over the live <b> is what measures it correctly.
//
//   * The row's `gap:0` (left over from the wordmark work) put the day chips
//     and the ONLY FREE control flush against each other at 0px, while the
//     removal of the "XXX Events" count took the `margin-left:auto` that used
//     to sit between ONLY FREE and FILTERS with it — leaving a 100px hole.
//
// This checks the rendered GEOMETRY, not the class names, because the point is
// what the reader sees.
const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const URL = "https://datebook.indigokarasu.com/";

let fails = 0;
const check = (label, ok, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
};

(async () => {
  const b = await pw.chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox"] });

  for (const vw of [1185, 1440, 1680]) {
    console.log(`\n== ${vw}px ==`);
    const p = await b.newPage({ viewport: { width: vw, height: 900 } });
    await p.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
    await p.waitForTimeout(2200);
    await p.evaluate(() => window.scrollTo(0, 1400));
    await p.waitForTimeout(1500);

    const r = await p.evaluate(() => {
      const top = document.querySelector(".fbar-top");
      const brand = top.querySelector(".brand");
      const bEl = brand.querySelector("b");
      // The untruncated advance width of the live text. A Range is not
      // clipped by the element's overflow, so it reports the real need.
      const rg = document.createRange();
      rg.selectNodeContents(bEl);
      const needs = Math.ceil(rg.getBoundingClientRect().width);
      const box = Math.ceil(brand.getBoundingClientRect().width);

      const kids = [...top.children]
        .filter((c) => getComputedStyle(c).display !== "none")
        .map((c) => ({ c, r: c.getBoundingClientRect() }));
      const gaps = [];
      for (let i = 1; i < kids.length; i++) {
        gaps.push({
          a: kids[i - 1].c.className || kids[i - 1].c.tagName,
          b: kids[i].c.className || kids[i].c.tagName,
          px: +(kids[i].r.x - kids[i - 1].r.right).toFixed(1),
        });
      }
      // Does the bar overflow horizontally? Anything past the content edge
      // means a control is unreachable.
      const wrap = document.querySelector("#bar .wrap");
      const wr = wrap.getBoundingClientRect();
      const overflow = kids.filter((k) => k.r.right > wr.right + 1 || k.r.x < wr.x - 1)
        .map((k) => k.c.className);
      return { needs, box, gaps, overflow, barH: +document.querySelector("#bar").getBoundingClientRect().height.toFixed(1) };
    });

    check("the wordmark is not clipped", r.box >= r.needs,
      `box ${r.box}px vs text ${r.needs}px`);
    const touching = r.gaps.filter((g) => g.px < 8);
    check("no two header controls are flush together", touching.length === 0,
      touching.length ? JSON.stringify(touching) : r.gaps.map((g) => g.px).join(", "));
    const hugeHole = r.gaps.filter((g) => g.px > 60);
    check("no unexplained dead space in the bar", hugeHole.length === 0,
      hugeHole.length ? JSON.stringify(hugeHole) : `max gap ${Math.max(...r.gaps.map((g) => g.px))}px`);
    check("nothing overflows the bar's content edge", r.overflow.length === 0,
      r.overflow.join(", ") || "clean");
    await p.close();
  }

  await b.close();
  console.log(fails ? `\n${fails} FAILING` : "\nPASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
