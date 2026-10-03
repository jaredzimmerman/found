const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");

// Measure the real baseline of "PM", the time digits, the price badge and the
// tag text, and report the deltas. A bounding box is useless for this: the
// badge has a border, so its box top is not its text top. The only honest
// measure is to insert a zero-width inline strut next to each and compare
// their vertical centres — that IS the baseline.
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  await p.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
  await p.waitForTimeout(600);

  const out = await p.evaluate(() => {
    function baselineOf(el) {
      if (!el) return null;
      const cs = getComputedStyle(el);
      // A strut whose font is inherited from el, sized to el's line-height.
      const strut = document.createElement("span");
      strut.textContent = "\u200b";
      strut.style.cssText =
        `display:inline-block;width:0;height:${cs.lineHeight};` +
        `vertical-align:baseline;`;
      el.appendChild(strut);
      const r = strut.getBoundingClientRect();
      const top = r.top + parseFloat(cs.lineHeight) / 2; // strut centre == baseline
      strut.remove();
      return top;
    }
    const rows = [...document.querySelectorAll("#list .row")];
    const samples = [];
    for (const r of rows) {
      const time = r.querySelector(".time");
      const mer = r.querySelector(".mer");
      const price = r.querySelector(".price");
      if (!time || !price) continue;
      samples.push({
        t: r.querySelector(".title")?.textContent.slice(0, 22),
        bTime: baselineOf(time),
        bMer: baselineOf(mer),
        bPrice: baselineOf(price),
        priceRight: Math.round(price.getBoundingClientRect().right),
        timeLeft: Math.round(time.getBoundingClientRect().left),
      });
      if (samples.length >= 8) break;
    }
    return samples;
  });

  for (const s of out) {
    const dMer = s.bMer != null && s.bTime != null ? +(s.bMer - s.bTime).toFixed(1) : null;
    const dPr = s.bPrice != null && s.bTime != null ? +(s.bPrice - s.bTime).toFixed(1) : null;
    console.log(
      `${(s.t || "").padEnd(24)} merΔ=${String(dMer).padStart(6)}  priceΔ=${String(dPr).padStart(6)}`
    );
  }
  const mer = out.map(s => s.bMer - s.bTime).filter(v => v != null && Math.abs(v) < 50);
  const pr = out.map(s => s.bPrice - s.bTime).filter(v => v != null && Math.abs(v) < 50);
  const mx = a => (a.length ? Math.max(...a.map(Math.abs)) : "n/a");
  console.log(`\nworst |merΔ| = ${mx(mer)}px   worst |priceΔ| = ${mx(pr)}px`);
  console.log("(target: under 1.5px for both)");
  await b.close();
})();
