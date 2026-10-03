// The bar's inner element carries TWO classes — "wrap" and "filters-in" — so it
// inherits .wrap's centering AND .filters-in's padding. Read the class list
// and both paddings off one element, and compare the bar's content edge to the
// kicker's content edge, which is the alignment the eye actually checks.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  for (const w of [390, 768, 1280]) {
    const page = await b.newPage({ viewport: { width: w, height: 1000 } });
    await page.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
    await page.waitForSelector("#list .row", { timeout: 25000 });
    const o = await page.evaluate(() => {
      const bar = document.querySelector(".filters-in");
      const mast = document.querySelector(".masthead .wrap");
      const kick = document.querySelector(".kicker");
      const cs = (e) => { const c = getComputedStyle(e); return { padL: c.paddingLeft, padR: c.paddingRight, marL: c.marginLeft, marR: c.marginRight, maxW: c.maxWidth }; };
      const edge = (e) => Math.round(e.getBoundingClientRect().left);
      // The first real chip or control inside the bar is the true content edge.
      const ctl = document.querySelector(".fbar-top > *");
      return {
        barClass: bar?.className,
        barStyle: bar ? cs(bar) : null,
        mastStyle: mast ? cs(mast) : null,
        barWrapLeft: bar ? edge(bar) : null,
        mastWrapLeft: mast ? edge(mast) : null,
        kickerContentLeft: kick ? Math.round(kick.getBoundingClientRect().left) : null,
        // content box left = border box left + padding
        barContentLeft: bar ? edge(bar) + parseFloat(cs(bar).padL) : null,
        firstControlLeft: ctl ? edge(ctl) : null,
        ftoggleLeft: (() => { const e = document.querySelector("#ftoggle"); return e ? edge(e) : null; })(),
      };
    });
    console.log(`\n=== ${w}px ===`);
    console.log("  bar class      :", o.barClass);
    console.log("  bar  pad/mar/max:", JSON.stringify(o.barStyle));
    console.log("  mast pad/mar/max:", JSON.stringify(o.mastStyle));
    console.log(`  kicker content L: ${o.kickerContentLeft}`);
    console.log(`  bar   content L: ${o.barContentLeft}`);
    console.log(`  ftoggle       L: ${o.ftoggleLeft}`);
    const d = o.kickerContentLeft - o.ftoggleLeft;
    console.log(`  >> MISCALIGNMENT: ${d}px  ${d === 0 ? "(aligned)" : "<-- BUG"}`);
    await page.close();
  }
  await b.close();
})();
