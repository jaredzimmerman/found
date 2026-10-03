// Measure the real geometry: does the filter bar's content align with the
// masthead's content above it, or is it inset/outset by a stray margin or
// padding? A screenshot alone can't tell you the number.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  for (const w of [390, 1280]) {
    const page = await b.newPage({ viewport: { width: w, height: 900 } });
    await page.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
    await page.waitForSelector("#list .row", { timeout: 20000 });
    const g = await page.evaluate(() => {
      const L = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), width: Math.round(r.width) }; };
      return {
        mastWrap: L(".masthead .wrap"),
        kicker: L(".kicker"),
        title: L(".title"),
        barEl: L(".filters"),
        barWrap: L(".filters-in"),
        fbarTop: L(".fbar-top"),
        frow: L(".frow"),
        firstChip: L("#f-type .chip"),
        listFirst: L("#list .row"),
        barStyle: (() => { const e = document.querySelector(".filters"); const c = getComputedStyle(e); return { pad: c.padding, mar: c.margin, pos: c.position, top: c.top }; })(),
        wrapStyle: (() => { const e = document.querySelector(".filters-in"); const c = getComputedStyle(e); return { pad: c.padding, mar: c.margin }; })(),
      };
    });
    console.log(`\n=== width ${w} ===`);
    for (const [k, v] of Object.entries(g)) {
      if (v && typeof v === "object" && "left" in v) {
        console.log(`  ${k.padEnd(12)} left=${String(v.left).padStart(4)} right=${String(v.right).padStart(4)} top=${String(v.top).padStart(4)} w=${v.width}`);
      } else {
        console.log(`  ${k.padEnd(12)} ${JSON.stringify(v)}`);
      }
    }
    // The alignment question, stated as a number.
    if (g.mastWrap && g.barWrap) {
      console.log(`  >> content left: masthead=${g.mastWrap.left} bar=${g.barWrap.left}  MISMATCH=${g.mastWrap.left - g.barWrap.left}`);
    }
    if (g.fbarTop && g.frow) {
      console.log(`  >> rail top=${g.fbarTop.top} frow top=${g.frow.top}  gap=${g.frow.top - (g.fbarTop.top + 0)}`);
    }
    await page.close();
  }
  await b.close();
})();
