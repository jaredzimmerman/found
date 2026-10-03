// The vision provider has failed on the pink-theme screenshot three times with
// an adapter error. Rather than retry a fourth time, measure what the eye would
// have judged: background colour, ink contrast, the dot screen, and geometry.
// A number is better evidence than a description anyway.
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
await p.evaluate(() => {
  localStorage.setItem("theme", "pink");
  document.documentElement.setAttribute("data-theme", "pink");
});
await p.reload({ waitUntil: "networkidle" });
await p.evaluate(() => document.fonts.ready);
await p.mouse.move(2, 2);
await p.waitForTimeout(1500);

const out = await p.evaluate(() => {
  const lum = (c) => {
    const m = c.match(/[\d.]+/g).map(Number);
    const [r, g, b] = m;
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
  };
  const cs = (sel, prop) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el)[prop] : null;
  };

  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const ink = cs("h1", "color") || cs(".title-e", "color");
  const bodyInk = cs(".desc", "color") || cs(".row p", "color") || ink;

  // Geometry: the three columns must sit flush with the container edges.
  const cards = [...document.querySelectorAll("article.row")].filter((e) => e.offsetParent !== null);
  const byLeft = new Map();
  for (const c of cards) {
    const x = Math.round(c.getBoundingClientRect().left);
    if (!byLeft.has(x)) byLeft.set(x, 0);
    byLeft.set(x, byLeft.get(x) + 1);
  }
  const xs = [...byLeft.keys()].sort((a, b) => a - b);
  const list = document.querySelector(".day-list");
  const lr = list ? list.getBoundingClientRect() : null;

  // The dot screen: the ::after on .figure, and the filter chip overlap.
  const fig = document.querySelector(".figure");
  const after = fig ? getComputedStyle(fig, "::after") : null;
  const chips = [...document.querySelectorAll("#frow .chip")].filter((c) => c.offsetParent !== null);
  let overlaps = 0;
  for (let i = 1; i < chips.length; i++) {
    const a = chips[i - 1].getBoundingClientRect();
    const b = chips[i].getBoundingClientRect();
    if (b.left < a.right - 0.5 && b.top < a.bottom - 0.5) overlaps++;
  }

  return {
    theme: document.documentElement.getAttribute("data-theme"),
    bodyBg,
    ink,
    contrast: { h1: ratio(bodyBg, ink), body: ratio(bodyBg, bodyInk) },
    wcag: { largeTextAA: 3, normalTextAA: 4.5, pass: ratio(bodyBg, bodyInk) >= 4.5 },
    cardImageFilter: fig ? getComputedStyle(fig.querySelector("img")).filter : null,
    dotScreen: after
      ? { content: after.content, blend: after.mixBlendMode, bg: after.backgroundColor, image: after.backgroundImage.slice(0, 60) }
      : null,
    columns: { xs, count: xs.length, containerLeft: lr ? Math.round(lr.left) : null, containerRight: lr ? Math.round(lr.right) : null },
    flushLeft: lr ? Math.round(cards[0].getBoundingClientRect().left) === Math.round(lr.left) : null,
    chipOverlaps: overlaps,
    renderedCards: cards.length,
  };
});

await b.close();
console.log(JSON.stringify(out, null, 2));
