// Programmatic stand-in for the visual review, for the properties a screenshot
// review is supposed to catch: type scale, grid alignment, spacing rhythm,
// clipping/overflow, and a11y basics.
//
// This is MEASUREMENT, not vision. It catches real defects (text cut off, a
// scale that collapses, ragged edges) but it cannot judge whether the result
// looks good. Both claims are kept separate on purpose.
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
await p.mouse.move(2, 2);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);

const audit = await p.evaluate(() => {
  const px = (v) => Math.round(parseFloat(v) * 100) / 100;
  const out = {};

  // ---- 1. type scale -----------------------------------------------------
  // Every distinct rendered size/weight/family, with how many elements use it.
  // A scale that reads as a scale has FEW distinct sizes used MANY times. One
  // used once is a stray, not a step.
  const tally = new Map();
  for (const el of document.querySelectorAll("body *")) {
    if (!el.offsetParent && el.tagName !== "BODY") continue;
    const cs = getComputedStyle(el);
    if (!el.textContent.trim() || el.children.length) continue;
    const k = `${cs.fontFamily.split(",")[0].replace(/["']/g, "")}|${px(cs.fontSize)}|${cs.fontWeight}|${cs.textTransform}`;
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  out.typeScale = [...tally.entries()]
    .map(([k, n]) => {
      const [family, size, weight, transform] = k.split("|");
      return { family, size: Number(size), weight, transform, count: n };
    })
    .sort((a, b) => a.size - b.size);
  out.distinctSizes = out.typeScale.length;
  out.singletons = out.typeScale.filter((t) => t.count === 1);

  // ---- 2. grid alignment -------------------------------------------------
  // Every row's left content edge must align to one of a small number of
  // gutters. A new x-origin per row is a broken grid.
  const xs = {};
  for (const r of document.querySelectorAll(".row")) {
    const x = Math.round(r.getBoundingClientRect().left);
    xs[x] = (xs[x] || 0) + 1;
  }
  out.rowLeftEdges = Object.entries(xs)
    .map(([x, n]) => ({ x: Number(x), n }))
    .sort((a, b) => b.n - a.n);

  // Column right edges: cards in masonry columns should end on a shared measure.
  const rights = {};
  for (const r of document.querySelectorAll(".row")) {
    const x = Math.round(r.getBoundingClientRect().right);
    rights[x] = (rights[x] || 0) + 1;
  }
  out.rowRightEdges = Object.entries(rights)
    .map(([x, n]) => ({ x: Number(x), n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);

  // ---- 3. spacing rhythm -------------------------------------------------
  // Vertical gaps between consecutive rows inside a column. Consistent rhythm
  // is what "proper spacing" means; one 3px and one 27px reads as broken.
  const gaps = [];
  const cols = new Map();
  for (const r of document.querySelectorAll(".row")) {
    const x = Math.round(r.getBoundingClientRect().left);
    const top = r.getBoundingClientRect().top;
    if (!cols.has(x)) cols.set(x, []);
    cols.get(x).push(top);
  }
  for (const [x, tops] of cols) {
    tops.sort((a, b) => a - b);
    for (let i = 1; i < tops.length; i++) {
      const prev = document.elementsFromPoint(x + 40, tops[i - 1] + 4);
      gaps.push(Math.round(tops[i] - tops[i - 1]));
    }
  }
  out.rowGaps = { min: Math.min(...gaps), max: Math.max(...gaps), sample: gaps.slice(0, 10) };

  // ---- 4. clipping / overflow ------------------------------------------
  // scrollWidth > clientWidth means the content does not fit its box. This is
  // the measurable form of "text is cut off".
  out.clipped = [];
  for (const el of document.querySelectorAll(".row *, .figure, .day-head, .count")) {
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const cs = getComputedStyle(el);
      if (cs.overflow === "visible" || cs.overflowX === "visible") continue; // wraps, fine
      out.clipped.push({
        cls: el.className,
        sw: el.scrollWidth,
        cw: el.clientWidth,
        text: (el.textContent || "").trim().slice(0, 40),
      });
    }
  }
  // Horizontal page scroll is the loudest layout failure there is.
  out.hScroll = {
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };

  // ---- 5. images --------------------------------------------------------
  out.images = {
    inDom: document.querySelectorAll(".figure img").length,
    broken: [...document.querySelectorAll(".figure img")].filter((i) => i.complete && i.naturalWidth === 0).length,
    zeroHeight: [...document.querySelectorAll(".figure img")].filter((i) => i.getBoundingClientRect().height < 20).length,
    loadingAttr: [...new Set([...document.querySelectorAll(".figure img")].map((i) => i.getAttribute("loading")))],
  };

  // ---- 6. a11y ----------------------------------------------------------
  out.a11y = {
    imgsNoAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
    btnsNoName: [...document.querySelectorAll("button")].filter(
      (b) => !b.textContent.trim() && !b.getAttribute("aria-label") && !b.title,
    ).length,
    linksNoName: [...document.querySelectorAll("a")].filter(
      (a) => !a.textContent.trim() && !a.getAttribute("aria-label"),
    ).length,
    headings: [...document.querySelectorAll("h1,h2,h3,h4")].reduce((m, h) => {
      m[h.tagName] = (m[h.tagName] || 0) + 1;
      return m;
    }, {}),
    // Heading order must not skip a level going down.
    headingSeq: [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => +h.tagName[1]),
    // Focus ring must survive; a `outline:none` with no replacement is a
    // keyboard trap dressed as a clean design.
    outlineNone: [...document.querySelectorAll("button,a,input,select")].filter(
      (e) => getComputedStyle(e).outlineStyle === "none" && !e.className.match(/sr|visually/),
    ).length,
    tapTargetsUnder24: [...document.querySelectorAll(".chip,.venue,.tag")].filter(
      (e) => e.offsetParent !== null && Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height) < 24,
    ).length,
  };
  out.a11y.headingSeq = out.a11y.headingSeq.slice(0, 12);

  // ---- 7. contrast ------------------------------------------------------
  // AA needs 4.5:1 for body text. Computed, not guessed.
  const lum = (c) => {
    const [r, g, bl] = c.match(/\d+/g).map((v) => {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const ratio = (a, bg) => {
    const [l1, l2] = [lum(a), lum(bg)].sort((x, y) => y - x);
    return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && !bg.includes("rgba(0, 0, 0, 0)")) return bg;
      n = n.parentElement;
    }
    return "rgb(255,255,255)";
  };
  const seen = new Set();
  out.contrast = [];
  for (const el of document.querySelectorAll(".row *, .standfirst, .day-head *, .count *, .masthead *")) {
    if (!el.offsetParent || el.children.length || !el.textContent.trim()) continue;
    const cs = getComputedStyle(el);
    const r = ratio(cs.color, bgOf(el));
    const size = px(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
    const need = large ? 3 : 4.5;
    if (r < need) {
      const key = el.className + cs.color;
      if (seen.has(key)) continue;
      seen.add(key);
      out.contrast.push({ cls: el.className, color: cs.color, size, ratio: r, need, sample: el.textContent.trim().slice(0, 30) });
    }
  }
  out.contrast.sort((a, b) => a.ratio - b.ratio);

  return out;
});

await b.close();
console.log(JSON.stringify(audit, null, 2));
