// The prov word is wrapping to its own line on 140/152 cards. `.meta` is
// flex-wrap:wrap with gap 6px 14px, and the address is a long unbreakable-ish
// string that fills the row, so the LAST item wraps. That was fine for
// venue+address; adding a third item tips it over.
//
// Before fixing, measure what is actually in the row and how much room is left.
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
await p.evaluate(() => document.fonts.ready);
await p.mouse.move(2, 2);
await p.waitForTimeout(900);

const out = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".row")].filter((r) => r.offsetParent !== null);

  // Distribution of meta children per card.
  const shapes = {};
  for (const r of rows) {
    const meta = r.querySelector(".meta");
    if (!meta) continue;
    const kids = [...meta.children].map((c) => ({
      tag: c.tagName.toLowerCase(),
      cls: c.className || "(none)",
      text: (c.textContent || "").trim().slice(0, 40),
      w: Math.round(c.getBoundingClientRect().width),
      top: Math.round(c.getBoundingClientRect().top),
    }));
    const key = kids.map((k) => k.cls.split(" ")[0]).join("+") || "(empty)";
    (shapes[key] = shapes[key] || []).push(kids);
  }

  const dist = Object.fromEntries(
    Object.entries(shapes).map(([k, v]) => [k, v.length])
  );

  // For wrapped cards, how much horizontal room is left on the venue's line?
  const wrapped = [];
  for (const r of rows) {
    const meta = r.querySelector(".meta");
    const prov = r.querySelector(".prov");
    if (!meta || !prov) continue;
    const mr = meta.getBoundingClientRect();
    const pr = prov.getBoundingClientRect();
    const venue = r.querySelector(".venue");
    if (venue && Math.abs(pr.top - venue.getBoundingClientRect().top) > 4) {
      wrapped.push({
        title: r.querySelector(".row-title")?.textContent.trim().slice(0, 40),
        metaW: Math.round(mr.width),
        provTop: Math.round(pr.top),
        venueTop: Math.round(venue.getBoundingClientRect().top),
        freeAtEndOfVenueLine:
          Math.round(mr.right - venue.getBoundingClientRect().right),
        kids: [...meta.children].map((c) => ({
          cls: (c.className || c.tagName).split(" ")[0],
          w: Math.round(c.getBoundingClientRect().width),
        })),
      });
    }
    if (wrapped.length >= 5) break;
  }

  // What fraction of the row width does the address consume?
  const widthStats = [];
  for (const r of rows.slice(0, 20)) {
    const meta = r.querySelector(".meta");
    if (!meta) continue;
    const addr = [...meta.children].find((c) => !c.className && c.tagName === "SPAN");
    if (addr) {
      widthStats.push({
        metaW: Math.round(meta.getBoundingClientRect().width),
        addrW: Math.round(addr.getBoundingClientRect().width),
        pct: Math.round((addr.getBoundingClientRect().width / meta.getBoundingClientRect().width) * 100),
      });
    }
  }

  return { childShapeDistribution: dist, wrappedSamples: wrapped, addressWidth: widthStats.slice(0, 8) };
});
await b.close();
console.log(JSON.stringify(out, null, 2));
