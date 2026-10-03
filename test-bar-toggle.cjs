// Does opening/closing the filter panel move anything in the fixed header?
//
// The claim under test: the controls in the always-visible line (wordmark,
// search, day pickers, only-free, Filters) keep their exact position across
// the toggle. Only the panel below them may change.
//
// The failure this catches: a `position:sticky` bar whose panel is a sibling
// in normal flow. Toggling the panel's height changes the bar's height, and
// because the sticky bar is anchored by its TOP, a height change re-anchors
// the sticky offset — the controls inside visibly jump. It also catches
// `align-items` shifts, where adding the panel's children changes the line's
// baseline and nudges the row.
const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const URL = "https://datebook.indigokarasu.com/";

let fails = 0;
const check = (label, ok, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
};

(async () => {
  const b = await pw.chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox"] });
  for (const w of [1024, 1440, 1920]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    await p.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
    await p.waitForTimeout(1200);
    // Open the panel, then compare against the closed state. Measure with the
    // panel CLOSED first so the reference is the resting layout.
    await p.evaluate(() => document.querySelector("#ftoggle").click());
    await p.waitForTimeout(500);
    const open = await p.evaluate(() => {
      const bar = document.querySelector("#bar");
      const g = (s) => { const e = bar.querySelector(s); if (!e) return null;
        const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; };
      return {
        brand: g(".brand b"), search: g(".search-wrap"), days: g(".day-pickers"),
        onlyFree: g(".only-free"), toggle: g(".ftoggle"),
        barH: Math.round(bar.getBoundingClientRect().height),
        scrollY: Math.round(scrollY),
      };
    });
    await p.evaluate(() => document.querySelector("#ftoggle").click());
    await p.waitForTimeout(500);
    const closed = await p.evaluate(() => {
      const bar = document.querySelector("#bar");
      const g = (s) => { const e = bar.querySelector(s); if (!e) return null;
        const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; };
      return {
        brand: g(".brand b"), search: g(".search-wrap"), days: g(".day-pickers"),
        onlyFree: g(".only-free"), toggle: g(".ftoggle"),
        barH: Math.round(bar.getBoundingClientRect().height),
        scrollY: Math.round(scrollY),
      };
    });
    console.log(`\n== ${w}px — fixed-header controls, open vs closed ==`);
    check("page did not scroll on toggle", open.scrollY === closed.scrollY, `${open.scrollY} vs ${closed.scrollY}`);
    check("panel actually opened (bar changed height)", open.barH > closed.barH, `open ${open.barH}px vs closed ${closed.barH}px`);
    for (const k of ["brand", "search", "days", "onlyFree", "toggle"]) {
      const o = open[k], c = closed[k];
      if (!o || !c) { check(`${k} present`, false, "missing"); continue; }
      check(`${k} does not move`,
        o.x === c.x && o.y === c.y && o.w === c.w,
        `x ${o.x}/${c.x}  y ${o.y}/${c.y}  w ${o.w}/${c.w}`);
    }
    await p.close();
  }
  await b.close();
  console.log(fails ? `\n${fails} FAILING` : "\nPASS — the fixed header is stable across the toggle");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
