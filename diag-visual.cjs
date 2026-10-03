const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  await p.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
  await p.waitForSelector(".figure img", { timeout: 20000 });
  await p.waitForTimeout(1200);

  const out = await p.evaluate(() => {
    const imgs = [...document.querySelectorAll(".figure img")].filter(i => i.getAttribute("src"));
    const cs = getComputedStyle(imgs[0]);
    // Dot radii straight from the SVG defs — this is the halftone's real pitch.
    const radii = [...document.querySelectorAll("#filter-defs circle, svg circle")]
      .map(c => c.getAttribute("r"))
      .filter(Boolean);
    return {
      imgs: imgs.length,
      loaded: imgs.filter(i => i.naturalWidth > 0).length,
      filter: cs.filter,
      radius: cs.borderRadius,
      transition: cs.transitionProperty + " " + cs.transitionDuration,
      objFit: cs.objectFit,
      aspect: cs.aspectRatio,
      naturalW: imgs[0]?.naturalWidth,
      shownW: Math.round(imgs[0]?.getBoundingClientRect().width),
      dotRadii: radii,
      chipRadius: getComputedStyle(document.querySelector(".chip"))?.borderRadius,
      chipGap: getComputedStyle(document.querySelector(".chips"))?.gap,
      dayName: (() => {
        const d = document.querySelector(".day-name");
        const c = getComputedStyle(d);
        return { text: d.textContent, transform: c.textTransform, size: c.fontSize,
                 border: getComputedStyle(document.querySelector(".day-head")).borderBottomWidth };
      })(),
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await p.screenshot({ path: "/tmp/shot-top.png" });
  await b.close();
})();
