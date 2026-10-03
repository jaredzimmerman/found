const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  const t = p.locator(".ftoggle").first();
  if (await t.count()) { await t.click(); await p.waitForTimeout(500); }
  const out = await p.evaluate(() => {
    const g = (s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return { h: Math.round(r.height), maxH: cs.maxHeight, ovf: cs.overflowY, disp: cs.display };
    };
    return {
      vh: innerHeight,
      filters: g(".filters"),
      filtersIn: g(".filters-in"),
      frow: g(".frow"),
      fbarTop: g(".fbar-top"),
      collapsed: document.querySelector(".filters")?.dataset.collapsed,
      // Which children of .filters-in are tall?
      kids: [...document.querySelectorAll(".filters-in > *")].map(k => ({
        cls: k.className, h: Math.round(k.getBoundingClientRect().height),
        disp: getComputedStyle(k).display,
      })),
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
