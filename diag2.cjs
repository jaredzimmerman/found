const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
  const out = await p.evaluate(() => {
    const rows = [...document.querySelectorAll("#list .row")].filter(r => r.querySelector(".price"));
    const bad = [];
    for (const r of rows) {
      const t = r.querySelector(".time").getBoundingClientRect();
      const q = r.querySelector(".price").getBoundingClientRect();
      const tc = r.querySelector(".time-col").getBoundingClientRect();
      if (Math.abs(t.left - q.left) > 1.5) bad.push({
        title: r.querySelector(".title")?.textContent.slice(0, 26),
        time: [Math.round(t.left), Math.round(t.top), Math.round(t.height)],
        price: [Math.round(q.left), Math.round(q.top), Math.round(q.height)],
        colLeft: Math.round(tc.left),
        dLeft: +(q.left - t.left).toFixed(1),
        parentOfPrice: r.querySelector(".price").parentElement.className,
      });
    }
    return { n: rows.length, bad: bad.slice(0, 4) };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
