// Prove the sold-out filter does what it claims on the real page.
// Run against the live URL so the assertion covers the deployed file, not a
// local copy that could have drifted from it.
// Playwright ships with the Hermes install rather than this project's
// node_modules, which only carries the XML parser.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const { pinnedPage } = require("./clock.cjs");
const URL = process.argv[2] || "https://pinkpages.indigokarasu.com/";
let fails = 0;

const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  [${detail}]` : ""}`);
  if (!ok) fails++;
};

(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await pinnedPage(b, { viewport: { width: 1280, height: 1200 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const failed = [];
  page.on("requestfailed", (r) => failed.push(r.url()));
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

  await page.goto(URL, { wait_until: "networkidle" });
  await page.waitForSelector(".row", { timeout: 20000 });

  console.log("\n== feed ==");
  // Sold-out rows are counted from the feed, but the page ALSO hides anything
  // that has already started. So the number of sold-out rows the page can
  // reveal is the feed's sold-out count MINUS those already begun — a sold-out
  // matinee is genuinely not a listing you can still walk into. The chip badge
  // counts visible candidates, so the oracle here must match that or the two
  // disagree for the rest of the run.
  const nowMin = await page.evaluate(() =>
    new Date().getHours() * 60 + new Date().getMinutes());
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const soldInFeed = await page.evaluate(async ([nowMin, today]) => {
    const d = await (await fetch("events.json")).json();
    const started = (e) => e.date === today && Number(e.startMinutes) >= 0 && Number(e.startMinutes) < nowMin;
    return {
      titles: d.events.filter((e) => e.soldOut).map((e) => e.title),
      visible: d.events.filter((e) => e.soldOut && !started(e)).map((e) => e.title),
      hidden: d.events.filter((e) => e.soldOut && started(e)).map((e) => e.title),
    };
  }, [nowMin, today]);
  const soldVisible = soldInFeed.visible.length;
  console.log(`  sold out: ${soldInFeed.titles.length} in feed, ${soldVisible} still reachable, ${soldInFeed.hidden.length} already started`);
  if (soldInFeed.hidden.length) console.log(`  already started: ${soldInFeed.hidden.join("; ")}`);
  check("feed carries soldOut records", soldInFeed.titles.length > 0, `${soldInFeed.titles.length}: ${soldInFeed.titles[0] || ""}`);
  // If every sold-out listing has already begun there is nothing left to prove,
  // and the rest of the section would fail for a reason that is not a defect.
  const canTest = soldVisible > 0;

  console.log("\n== hidden by default ==");
  const shown = await page.locator(".row").count();
  const badTags = await page.locator(".tag.gone").count();
  check("no sold-out row is visible by default", badTags === 0, `${badTags} tags on page`);
  const withSold = await page.evaluate(
    () => document.querySelectorAll(".row.sold").length);
  check("no .sold row rendered by default", withSold === 0, String(withSold));

  console.log("\n== sold-out toggle ==");
      // Chips are hidden while the filter bar is collapsed.
      await page.click("#ftoggle");
      await page.waitForTimeout(350);
      const soldChip = await page.locator("#f-sold .chip");
      check("availability chip exists", (await soldChip.count()) === 1);
      const label = (await soldChip.innerText()).replace(/\s+/g, " ").trim();
          check("chip is labelled and counted", /Hide sold out/.test(label), label);
          const badge = (await soldChip.locator(".n").innerText()).trim();
          check("chip count equals the reachable sold-out count",
            Number(badge) === soldVisible, `${badge} vs ${soldVisible}`);

          await soldChip.click();
          await page.waitForTimeout(300);
          const after = await page.locator(".row").count();
          const soldRows = await page.evaluate(() => document.querySelectorAll(".row.sold").length);
  check("toggling reveals sold-out rows", canTest ? soldRows > 0 : true,
    `${soldRows}${canTest ? "" : " (none reachable — skipped)"}`);
  check("total grows by exactly the sold-out count",
    after - shown === soldVisible, `+${after - shown} vs ${soldVisible}`);
  check("every sold-out row is badged",
        (await page.locator(".row.sold .tag.gone").count()) === soldRows);
    const firstSold = await page.locator(".row.sold .title-e").first().innerText();
    check("sold-out title matches the feed", soldInFeed.titles.some((t) => firstSold.includes(t.split(" ")[0])),
      firstSold.slice(0, 40));

    console.log("\n== toggling back ==");
        await soldChip.click();
        await page.waitForTimeout(300);
        check("re-toggle restores the original count",
          (await page.locator(".row").count()) === shown);
        // When all filters are off, the reset button is HIDDEN (the UI shows it
        // only when something is actually filtered).
        check("reset remains hidden when all filters are off",
          (await page.locator("#reset").isHidden()) === true);
        // Now turn a filter back on, reset must appear.
        await soldChip.click();
        await page.waitForTimeout(300);
        check("clear-filters button appears when a filter is on",
          (await page.locator("#reset").isVisible()) === true);
        await page.locator("#reset").click();
        await page.waitForTimeout(300);
        check("clear filters re-hides sold out",
          (await page.evaluate(() => document.querySelectorAll(".row.sold").length)) === 0);

  console.log("\n== combinations ===");
    // Sold-out must still respect the other filters, not bypass them.
    await soldChip.click();
    await page.waitForTimeout(200);
    const venueOpts = await page.locator("#f-venue option").allTextContents();
  const target = venueOpts.find((v) => v && v !== "All venues");
  await page.selectOption("#f-venue", target);
  await page.waitForTimeout(300);
  const venues = await page.evaluate(() =>
    [...document.querySelectorAll(".row .venue")].map((v) => v.textContent));
  check("venue filter holds with sold-out shown",
    venues.every((v) => v === target), `${target} / ${venues.length} rows`);
  await page.locator("#reset").click();
  await page.waitForTimeout(200);

  console.log("\n== hygiene ==");
  check("no JS errors", errors.length === 0, errors.join("; "));
  check("no failed requests", failed.length === 0, failed.join("; "));
  const mono = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("body, body *")) {
      const s = getComputedStyle(el);
      for (const c of [s.color, s.backgroundColor]) {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) continue;
        const p = m[1].split(",").map(Number);
        if (p.length === 4 && p[3] > 0.02 &&
            Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]) > 26) bad.push(c);
      }
    }
    return [...new Set(bad)];
  });
  check("page is still monochrome", mono.length === 0, mono.join(","));

  await b.close();
  console.log();
  console.log(fails ? `${fails} FAILED` : "ALL GOOD");
  process.exit(fails ? 1 : 0);
})();
