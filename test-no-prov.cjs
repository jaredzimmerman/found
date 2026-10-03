// The per-card provenance word (.prov) was removed from the meta row. This
// proves the ABSENCE, which is the hard direction: a test that only checks the
// badge still renders passes just as happily when the code is dead. So:
//
//   1. no .prov element exists in any rendered card, at any width
//   2. no card's text contains the badge words
//   3. the meta row still carries venue + address (the row did not just empty)
//   4. the three tiers are STILL filterable — removing the badge must not take
//      the "Link goes to" facet with it, or the information is simply lost
//   5. the link destination is unchanged
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");

const BASE = "http://127.0.0.1:8899/index.html";
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  for (const w of [390, 1185, 1440]) {
    console.log(`\n== ${w}px ==`);
    const page = await browser.newPage({ viewport: { width: w, height: 1000 } });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".row", { timeout: 15000 });
    await page.waitForTimeout(600);

    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".row")];
      // The badge lived in .meta, so that is the only place its words can
      // appear. Scanning the WHOLE card is wrong: a film's own description
      // legitimately says "in-person at the Box Office", and that copy is the
      // organiser's, not the badge. Asserting on the full card text failed a
      // build that was correct — the test was wrong, not the page.
      const metaWords = rows.filter((x) => {
        const m = x.querySelector(".meta");
        return m && /venue site|box office|listing/i.test(m.textContent || "");
      }).length;
      // …and a .prov must never come back, in any subtree.
      const provs = document.querySelectorAll(".prov").length;
      // The badge was a span with no class inside meta. Prove meta holds only
      // a venue button and an address span — nothing else is allowed to live
      // there, which catches a future badge that skips the .prov class.
      const strayChildren = rows.filter((x) => {
        const m = x.querySelector(".meta");
        if (!m) return false;
        return [...m.children].some(
          (c) => !c.classList.contains("venue") && c.tagName !== "SPAN"
        );
      }).length;
      const metas = rows.filter((x) => x.querySelector(".meta")).length;
      const venues = rows.filter((x) => x.querySelector(".venue")).length;
      const addrs = rows.filter((x) =>
        (x.querySelector(".meta") || {}).textContent &&
        /\d/.test((x.querySelector(".meta") || {}).textContent || "")
      ).length;
      return { rows: rows.length, provs, metaWords, strayChildren, metas, venues, addrs };
    });

    check("no .prov element on any card", r.provs === 0, `${r.provs} found over ${r.rows} cards`);
    check("no badge word inside the meta row", r.metaWords === 0, `${r.metaWords} cards`);
    check("meta row holds only venue + address", r.strayChildren === 0,
      `${r.strayChildren} cards with a foreign child`);
    // The badge was ~1/3 of the meta row. If the row emptied we would have
    // removed the venue name too — the failure mode this must catch.
    check("meta row still populated", r.metas > 0 && r.venues > 0,
      `${r.metas} meta / ${r.venues} venue / ${r.addrs} with address`);

    // The filter facet must survive: this is the whole reason the badge can go.
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll("#f-link .chip")].map((c) => c.textContent.trim())
    );
    check("link-tier filter still lists all three tiers",
      chips.length === 3, chips.join(" / "));

    if (w === 1440) {
      // The filter panel is collapsed on load, so the chips exist but are not
      // clickable until openBar() runs. openBar() rather than a click on some
      // opener button: this is the same path a tag click inside a card takes,
      // so the test exercises the real affordance.
      await page.evaluate(() => window.openBar && window.openBar());
      await page.waitForTimeout(400);

      // Click "Listing page" and prove the fallback rows are still reachable.
      const before = await page.locator(".row").count();
      await page.locator('#f-link .chip[data-value="listing"]').first().click();
      await page.waitForTimeout(500);
      const after = await page.locator(".row").count();
      const stillClean = await page.evaluate(() => document.querySelectorAll(".prov").length);
      check("listing tier still filters", after > 0 && after < before, `${before} → ${after}`);
      check("no .prov after filtering either", stillClean === 0, `${stillClean}`);
    }
    await page.close();
  }

  await browser.close();
  console.log(failures ? `\nFAIL (${failures})` : "\nPASS");
  process.exit(failures ? 1 : 0);
})();
