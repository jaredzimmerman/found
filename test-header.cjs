// The fixed header: order, geometry and BASELINE ALIGNMENT.
//
// Measuring a text baseline in a browser is easy to do wrongly, and the
// obvious methods all give a plausible wrong number:
//
//   * a probe <span> with `position:absolute` measures the probe's own box
//     anchored to the element's padding box — not the element's text baseline;
//   * appending a probe to an <input> silently does nothing, because <input>
//     is a void element and cannot hold children, so the probe lands in the
//     parent and reports the wrong element's position;
//   * canvas `measureText` reports the metrics of whatever font the canvas
//     resolves AT THAT MOMENT, which changes between a run where the webfont
//     has loaded and one where it has not.
//
// The only measurement that survives all three is to read the INK BOX of the
// element's own text via a Range, and to locate the <input>'s baseline from
// its own content box using the SAME font metrics read at the same instant.
// Everything is read in one `evaluate` so the font state cannot change
// mid-measurement.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const { pinnedPage } = require("./clock.cjs");

const SITE = process.argv[2] || "https://datebook.indigokarasu.com/";
let fails = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails++;
};

(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await pinnedPage(b, { viewport: { width: 1440, height: 1000 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#list .row", { timeout: 25000 });
  // The webfont must be settled before any font metric is read, or the metrics
  // come from the fallback and every baseline is off by a different amount.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);

  console.log("== the bar reads in the order the brief asks for ==");
  const order = await page.evaluate(() =>
    [...document.querySelectorAll(".fbar-top > *")].map((c) => c.id || c.className.split(" ")[0]));
  check("brand, search, day pickers, count, only-free, filters",
    JSON.stringify(order) === JSON.stringify(
      ["brand", "search-wrap", "f-day-rail", "count", "only-free", "right"]),
    order.join(" > "));

  const geo = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const o = (s) => ({ l: Math.round(r(s).left), rt: Math.round(r(s).right) });
    return { brand: o(".brand b"), search: o(".search-wrap"), days: o("#f-day-rail"),
             count: o(".count"), of: o("#only-free"), ft: o("#ftoggle") };
  });
  check("the logo is leftmost", geo.brand.l < geo.search.l, `${geo.brand.l} < ${geo.search.l}`);
  check("the day pickers follow the search", geo.search.rt <= geo.days.l,
    `search ends ${geo.search.rt}, days start ${geo.days.l}`);
  check("ONLY FREE is immediately left of FILTERS",
    geo.of.rt <= geo.ft.l && geo.ft.l - geo.of.rt <= 24, `${geo.ft.l - geo.of.rt}px gap`);
  // "Right-packed" does not mean the three items share a right EDGE — they
  // are separate flex children separated by the bar's gap, so the count's right
  // edge is naturally short of FILTERS'. The invariant is that they form one
  // group pushed to the bar's content edge: FILTERS ends flush with .fbar-top,
  // and the whole group sits to the right of the day pickers.
  //
  // The edge is measured on `.fbar-top`, NOT `.filters-in`. `.filters-in` is
  // the panel's own scroll container and carries its own horizontal padding,
  // so its right edge sits ~24px outside the bar's content — measuring against
  // it reported a 24px "unpacked" bar that was in fact flush.
  const wrap = await page.evaluate(() => {
    const r = document.querySelector(".fbar-top").getBoundingClientRect();
    return { l: Math.round(r.left), rt: Math.round(r.right) };
  });
  check("the control group is packed to the bar's right edge",
    Math.abs(geo.ft.rt - wrap.rt) <= 2, `FILTERS ends ${geo.ft.rt}, content ends ${wrap.rt}`);
  check("the group sits to the right of the day pickers",
    geo.count.l > geo.days.rt, `count@${geo.count.l}, days end ${geo.days.rt}`);
  check("the count, ONLY FREE and FILTERS read as one right-hand group",
    (geo.of.rt - geo.count.rt) > 0 && (geo.ft.l - geo.of.rt) > 0 &&
    geo.count.l > geo.days.rt && Math.abs(geo.ft.rt - wrap.rt) <= 2,
    `count@${geo.count.l}(w${geo.count.rt - geo.count.l}) days end ${geo.days.rt}, ` +
    `onlyfree@${geo.of.l}, filters@${geo.ft.l}, content ends ${wrap.rt}`);
  // The two gaps need not be equal — the count is a stacked block whose box is
  // as wide as its widest line ("86" above "events"), so its edge-to-edge
  // distance to ONLY FREE is naturally wider than the gap between the two
  // buttons. What has to hold is that NOTHING large separates them: the gap
  // between the count and ONLY FREE must stay well under a chip's width.
  check("no wide gap separates the count from ONLY FREE",
    geo.of.l - geo.count.rt < 60, `${geo.of.l - geo.count.rt}px between them`);

  console.log("\n== the search field is a line and a lens, not a box ==");
  const field = await page.evaluate(() => {
    const w = document.querySelector(".search-wrap");
    const i = document.querySelector("#f-q");
    const cs = (e) => getComputedStyle(e);
    return {
      wrapBorder: [cs(w).borderTopWidth, cs(w).borderRightWidth, cs(w).borderBottomWidth, cs(w).borderLeftWidth],
      inputBorder: [cs(i).borderTopWidth, cs(i).borderRightWidth, cs(i).borderBottomWidth, cs(i).borderLeftWidth],
      icon: !!document.querySelector(".s-ico"),
      iconW: Math.round(document.querySelector(".s-ico").getBoundingClientRect().width),
      padLeft: parseFloat(cs(i).paddingLeft),
    };
  });
  check("no box around the field: only a bottom rule",
    field.wrapBorder[0] === "0px" && field.wrapBorder[2] !== "0px" &&
    field.wrapBorder[1] === "0px" && field.wrapBorder[3] === "0px",
    field.wrapBorder.join(" / "));
  check("the input itself carries no border",
    field.inputBorder.every((b) => b === "0px"), field.inputBorder.join(" / "));
  check("there is a lens icon", field.icon);
  // The input's own border box starts at the wrap's left edge — its 20px
  // left padding is INSIDE that box. So comparing two border boxes would
  // always report them as coincident and pass for the wrong reason. The
  // thing to check is that the padding is non-zero (so the text clears the
  // absolutely positioned lens) and wide enough to clear the icon.
  check("the text is indented past the lens",
    field.padLeft >= field.iconW + 4 && field.padLeft > 0,
    `padding-left ${field.padLeft}px, icon ${field.iconW}px`);

  console.log("\n== ONLY FREE and FILTERS are the same control ==");
  const pair = await page.evaluate(() => {
    const cs = (s) => { const c = getComputedStyle(document.querySelector(s));
      return { fs: c.fontSize, fw: c.fontWeight, ls: c.letterSpacing,
               pad: c.padding, bw: c.borderTopWidth, h: Math.round(document.querySelector(s).getBoundingClientRect().height) }; };
    return { of: cs("#only-free"), ft: cs("#ftoggle") };
  });
  for (const k of ["fs", "fw", "ls", "pad", "bw", "h"]) {
    check(`ONLY FREE matches FILTERS on ${k}`, pair.of[k] === pair.ft[k], `${pair.of[k]} vs ${pair.ft[k]}`);
  }

  console.log("\n== one baseline across the bar ==");
  const bl = await page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    const metrics = (el) => {
      const c = getComputedStyle(el);
      ctx.font = `${c.fontWeight} ${c.fontSize}px ${c.fontFamily}`;
      return ctx.measureText("Hxg");
    };
    // A Range over an element's own text node: the ink box of real rendered
    // text. textBaseline = inkBox.bottom - descent.
    const inkBaseline = (sel) => {
      const el = document.querySelector(sel);
      const t = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!t) return null;
      const r = document.createRange();
      r.selectNodeContents(t);
      const rects = [...r.getClientRects()].filter((x) => x.height > 0);
      if (!rects.length) return null;
      return rects[0].bottom - metrics(el).fontBoundingBoxDescent;
    };
    // An <input> holds no text node and cannot be given one. Its baseline is
    // derived from its own content box with the same metrics: the flex baseline
    // uses the bottom MARGIN edge, and inside that edge the text baseline sits
    // the font's descent above the content box bottom.
    const inputBaseline = (sel) => {
      const el = document.querySelector(sel);
      const c = getComputedStyle(el);
      const m = metrics(el);
      const mb = parseFloat(c.marginBottom) || 0;
      const bb = parseFloat(c.borderBottomWidth) || 0;
      return el.getBoundingClientRect().bottom - mb - bb - m.fontBoundingBoxDescent;
    };
    const out = {
      brand: inkBaseline(".brand b"),
      search: inputBaseline("#f-q"),
      dayChip: inkBaseline("#f-day-rail .chip"),
      onlyFree: inkBaseline("#only-free span"),
      filters: inkBaseline(".ftoggle-t"),
    };
    // Where the lens sits relative to the field's own text: the icon is a
    // circle, so it is compared against the x-height band, not a baseline.
    const i = document.querySelector("#f-q");
    const c = getComputedStyle(i);
    const m = metrics(i);
    const ib = inputBaseline("#f-q");
    out.iconCentre = document.querySelector(".s-ico").getBoundingClientRect().top +
      document.querySelector(".s-ico").getBoundingClientRect().height / 2;
    out.xHeightCentre = ib - m.fontBoundingBoxAscent * 0.55;
    return out;
  });
  const keys = ["brand", "search", "dayChip", "onlyFree", "filters"];
  const spread = Math.max(...keys.map((k) => bl[k])) - Math.min(...keys.map((k) => bl[k]));
  const deltas = keys.map((k) => `${k} ${(bl[k] - bl.search).toFixed(1)}`).join(", ");
  check("every control in the bar shares one baseline (within 1.5px)", spread <= 1.5,
    `spread ${spread.toFixed(2)}px — ${deltas}`);
  check("the lens is centred on the field's x-height, not sitting on the rule",
    Math.abs(bl.iconCentre - bl.xHeightCentre) <= 3,
    `icon ${bl.iconCentre.toFixed(1)} vs x-height ${bl.xHeightCentre.toFixed(1)}`);

  console.log("\n== hygiene ==");
  check("no console errors", errs.length === 0, errs.slice(0, 2).join(" | "));

  await b.close();
  console.log(fails ? `\n${fails} FAILING` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
