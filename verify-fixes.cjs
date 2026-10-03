// Verify the four reported items against the live page, by measurement:
//   1. the range label must be readable, not "T 29 - T 1";
//   2. the price sits in the time column, left-aligned under the time;
//   3. the venue is not styled as a chip;
//   4. the bar aligns with the masthead.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
let fails = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail !== undefined ? " — " + detail : ""}`);
  if (!ok) fails++;
};

(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  // networkidle is not a reliable readiness signal here: the nightly rebuild
  // rewrites events.json, and a request in flight at that moment makes the
  // page wait past the timeout. Wait on the rendered row instead, with the
  // feed's own fetch re-run if it somehow did not land.
  await page.goto("https://datebook.indigokarasu.com/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#list .row", { timeout: 45000 });

  console.log("== 1. the range label ==");
  const range = await page.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return e && getComputedStyle(e).display !== "none" ? e.textContent.trim() : null; };
    return { long: vis("#range"), short: vis("#range-s") };
  });
  console.log("    long:", JSON.stringify(range.long), "short:", JSON.stringify(range.short));
  const shown = range.short || range.long;
  check("range shown", !!shown, shown);
  check("no single-letter weekday", !/\bT\s+\d/.test(shown), shown);
  // The kicker is uppercased by CSS, so compare case-insensitively: the DOM
  // text is "tue 29 – thu 1" but the reader sees "TUE 29 – THU 1".
  check("weekday readable (3-letter abbrev or full name)",
    /(?:\b(mon|tue|wed|thu|fri|sat|sun)\b)|(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(shown), shown);
  // Distinct days must not collapse to the same label.
  const dayChips = await page.evaluate(() =>
    [...document.querySelectorAll("#f-day .chip")].map((c) => c.textContent.trim()));
  check("day chips are distinct", new Set(dayChips).size === dayChips.length, dayChips.join(" | "));

  console.log("\n== 2. price under the time ==");
  const geo = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#list .row")].filter((r) => r.querySelector(".price"));
    if (!rows.length) return { none: true };
    const r = rows[0];
    const t = r.querySelector(".time").getBoundingClientRect();
    const p = r.querySelector(".price").getBoundingClientRect();
    const inCol = !!r.querySelector(".time-col .price");
    return {
      timeLeft: Math.round(t.left), priceLeft: Math.round(p.left),
      timeBottom: Math.round(t.bottom), priceTop: Math.round(p.top),
      inTimeCol: inCol, n: rows.length,
      priceInMeta: !!r.querySelector(".meta .price"),
    };
  });
  console.log("   ", JSON.stringify(geo));
  check("a row has a price", !geo.none);
  if (!geo.none) {
    check("price lives in the time column", geo.inTimeCol);
    check("price is NOT in the meta row", !geo.priceInMeta);
    check("price left-aligned with the time", geo.priceLeft === geo.timeLeft, `${geo.priceLeft} vs ${geo.timeLeft}`);
    check("price sits BELOW the time", geo.priceTop >= geo.timeBottom, `${geo.priceTop} >= ${geo.timeBottom}`);
  }

  console.log("\n== 3. venue is not a chip ==");
  const ven = await page.evaluate(() => {
    const v = document.querySelector("#list .row .venue");
    if (!v) return { none: true };
    const c = getComputedStyle(v);
    return { tag: v.tagName, border: c.borderTopWidth, bg: c.backgroundColor, radius: c.borderRadius, pad: c.paddingTop, weight: c.fontWeight, cls: v.className };
  });
  console.log("   ", JSON.stringify(ven));
  check("venue exists", !ven.none);
  if (!ven.none) {
    check("venue has no border (not a chip)", parseFloat(ven.border) === 0, ven.border);
    check("venue is not shaded", ven.bg === "rgba(0, 0, 0, 0)" || ven.bg === "transparent", ven.bg);
    check("venue is a button (affordance)", ven.tag === "BUTTON", ven.tag);
  }

  console.log("\n== 4. bar alignment ==");
  const al = await page.evaluate(() => {
    const k = Math.round(document.querySelector(".kicker").getBoundingClientRect().left);
    const f = Math.round(document.querySelector("#ftoggle").getBoundingClientRect().left);
    return { k, f, d: k - f };
  });
  check("bar aligns with masthead", al.d === 0, `${al.k} vs ${al.f}`);

  await page.screenshot({ path: "/tmp/fix-mobile.png", fullPage: false });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/fix-desktop.png" });
  await b.close();
  console.log(fails ? `\n${fails} FAILING` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
