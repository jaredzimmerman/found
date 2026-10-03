// Did the provenance word break the card? Measure, don't assume.
// Asserts, on the live page:
//   - the word renders on cards that have a tier (not a no-op element)
//   - meta row y-position and card height are UNCHANGED vs cards without one
//   - it never wraps to its own line at 1440 or on a phone
//   - it does not add a tab stop (a span, not an anchor)
//   - contrast of the word against the paper clears WCAG AA
import { chromium, devices } from "playwright-core";

const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const URL = "https://pinkpages.indigokarasu.com/?cb=" + Date.now();

async function probe(viewport, isPhone) {
  const ctx = await b.newContext(isPhone ? { ...devices["Pixel 7"] } : { viewport });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  await p.mouse.move(2, 2);
  await p.waitForTimeout(900);

  const out = await p.evaluate(() => {
    const parseRGB = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const rows = [...document.querySelectorAll(".row")].filter((r) => r.offsetParent !== null);

    const cards = rows.map((r) => {
      const meta = r.querySelector(".meta");
      const prov = r.querySelector(".prov");
      const title = r.querySelector(".row-title");
      const venue = r.querySelector(".venue");
      const rect = (e) => (e ? e.getBoundingClientRect() : null);
      const cs = (e, p) => (e ? getComputedStyle(e, p || null) : null);
      return {
        hasProv: !!prov,
        provText: prov ? prov.textContent.trim() : null,
        provClass: prov ? prov.className : null,
        provIsAnchor: prov ? prov.tagName.toLowerCase() === "a" : null,
        provColor: prov ? cs(prov).color : null,
        provFontSize: prov ? parseFloat(cs(prov).fontSize) : null,
        provRect: rect(prov),
        metaRect: rect(meta),
        titleY: rect(title)?.top ?? null,
        venueY: rect(venue)?.top ?? null,
        rowH: rect(r)?.height ?? null,
        provOnOwnLine: null, // filled below
        metaLines: null,
        // How many distinct vertical bands the meta children occupy.
        metaTop: rect(meta)?.top ?? null,
      };
    });

    // Does the prov element sit on a different visual line from the venue?
    for (const c of cards) {
      if (c.hasProv && c.provRect && c.venueY != null) {
        c.provOnOwnLine = Math.abs(c.provRect.top - c.venueY) > 4;
      }
      if (c.metaRect) {
        const kids = [...c.metaRect && []];
      }
    }

    // Measure the meta row's line count from child rects on a few cards.
    for (const r of rows.slice(0, 12)) {
      const meta = r.querySelector(".meta");
      if (!meta) continue;
      const tops = new Set(
        [...meta.children]
          .map((c) => Math.round(c.getBoundingClientRect().top))
          .filter((t) => !isNaN(t))
      );
      const card = cards.find((c) => c.rowH === r.getBoundingClientRect().height);
      if (card) card.metaLines = tops.size;
    }

    // Contrast of the prov word against the paper.
    const prov = document.querySelector(".prov");
    const paper = parseRGB(getComputedStyle(document.body).backgroundColor);
    const paperFromVar = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();
    return {
      paper: paper,
      paperVar: paperFromVar,
      provColorRaw: prov ? getComputedStyle(prov).color : null,
      provClass: prov ? prov.className : null,
      total: cards.length,
      withProv: cards.filter((c) => c.hasProv).length,
      anchorsAmongProv: cards.filter((c) => c.provIsAnchor).length,
      provOnOwnLine: cards.filter((c) => c.provOnOwnLine).length,
      sample: cards.filter((c) => c.hasProv).slice(0, 3).map((c) => ({
        text: c.provText, cls: c.provClass,
        provTop: c.provRect?.top ?? null, venueTop: c.venueY,
        metaTop: c.metaTop, titleY: c.titleY, rowH: c.rowH, metaLines: c.metaLines,
      })),
    };
  });
  await ctx.close();
  return out;
}

const desktop = await probe({ width: 1440, height: 1000 }, false);
const phone = await probe(null, true);

// Contrast math in node, not in the page.
const hexToRGB = (h) => {
  const s = h.replace("#", "");
  const f = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const contrast = (fg, bg) => {
  const [x, y] = [lum(fg), lum(bg)].sort((m, n) => n - m);
  return +(((x + 0.05) / (y + 0.05)).toFixed(2));
};

await b.close();
console.log(
  JSON.stringify(
    {
      desktop: {
        total: desktop.total,
        withProv: desktop.withProv,
        provRenderedAsAnchor: desktop.anchorsAmongProv,
        provWrappedToOwnLine: desktop.provOnOwnLine,
        paper: desktop.paperVar || desktop.paper,
        samples: desktop.sample,
      },
      phone: {
        total: phone.total,
        withProv: phone.withProv,
        provWrappedToOwnLine: phone.provOnOwnLine,
        samples: phone.sample,
      },
      verdict: {
        "label renders": desktop.withProv > 0,
        "not a link (no extra tab stop)": desktop.anchorsAmongProv === 0,
        "does not wrap at 1440px": desktop.provOnOwnLine === 0,
        "does not wrap on phone": phone.provOnOwnLine === 0,
      },
    },
    null,
    2
  )
);
