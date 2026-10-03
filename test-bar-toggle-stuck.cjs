// The same stability question, but with the bar STUCK.
//
// test-bar-toggle.cjs runs at scrollY 0, where the bar is still in normal flow
// at its natural position and a height change cannot move it. That is the easy
// case. The hard case is once the bar is `position:sticky` and pinned: a sticky
// box is anchored by its top edge, so when the panel opens and the bar grows
// downward, the browser re-anchors the sticky offset. If `--barh` is read from
// the bar's own offsetHeight, that is a feedback loop — grow, re-anchor, grow.
const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const URL = "https://datebook.indigokarasu.com/";

let fails = 0;
const check = (label, ok, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
};

(async () => {
  const b = await pw.chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox"] });
  for (const w of [1024, 1440]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    await p.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
    await p.waitForTimeout(1200);
    // Scroll so the bar is stuck, and the wordmark has animated in.
    await p.evaluate(() => scrollTo(0, 1200));
    await p.waitForTimeout(900);

    const snap = () => p.evaluate(() => {
      const bar = document.querySelector("#bar");
      const g = (s) => { const e = bar.querySelector(s); if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; };
      return {
        barTop: Math.round(bar.getBoundingClientRect().top),
        barH: Math.round(bar.getBoundingClientRect().height),
        scrollY: Math.round(scrollY),
        barhVar: getComputedStyle(document.documentElement).getPropertyValue("--barh").trim(),
        panelH: Math.round(document.querySelector(".frow").getBoundingClientRect().height),
        panelTop: Math.round(document.querySelector(".frow").getBoundingClientRect().top),
        brand: g(".brand b"), search: g(".search-wrap"), days: g(".day-pickers"),
        onlyFree: g(".only-free"), toggle: g(".ftoggle"),
      };
    });

    const before = await snap();
    await p.evaluate(() => document.querySelector("#ftoggle").click());
    await p.waitForTimeout(600);
    const open = await snap();
    await p.evaluate(() => document.querySelector("#ftoggle").click());
    await p.waitForTimeout(600);
    const after = await snap();

    console.log(`\n== ${w}px — STUCK bar, open vs closed ==`);
    check("bar was actually stuck before the test", before.barTop <= 1, `barTop ${before.barTop}`);
    check("wordmark had animated in", before.brand.w > 0, `brand ${before.brand.w}px`);
    check("page did not scroll on toggle", open.scrollY === before.scrollY && after.scrollY === before.scrollY,
      `${before.scrollY} / ${open.scrollY} / ${after.scrollY}`);
    check("bar's top edge is pinned to the viewport in both states",
      open.barTop === before.barTop && after.barTop === before.barTop,
      `${before.barTop} / ${open.barTop} / ${after.barTop}`);
    // The panel no longer GROWS the bar — that was the bug. It is taken out of
    // flow and overlays the listings, so the bar's height is unchanged by
    // design. What must be true instead is that the panel is actually on
    // screen and visible when open, and gone when closed. Asserting "the bar
    // got taller" here would be asserting the defect.
    check("the bar does NOT grow when the panel opens (that was the jump)",
      open.barH === before.barH, `${before.barH}px -> ${open.barH}px`);
    check("the panel is on screen and visible when open",
      open.panelH > 100 && open.panelTop >= 0 && open.panelTop < 900,
      `panel ${open.panelH}px tall at y=${open.panelTop}`);
    check("the panel is gone when closed", after.panelH === 0, `${after.panelH}px`);
    for (const k of ["brand", "search", "days", "onlyFree", "toggle"]) {
      const c = before[k], o = open[k], a = after[k];
      if (!c || !o || !a) { check(`${k} present`, false, "missing"); continue; }
      check(`${k} does not move`,
        c.x === o.x && c.y === o.y && c.w === o.w && c.x === a.x && c.y === a.y && c.w === a.w,
        `closed ${c.x},${c.y},${c.w}  open ${o.x},${o.y},${o.w}  reclosed ${a.x},${a.y},${a.w}`);
    }
    await p.close();
  }
  await b.close();
  console.log(fails ? `\n${fails} FAILING` : "\nPASS — the stuck bar is stable across the toggle");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
