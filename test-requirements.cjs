// Verify the three filters Jared asked for, plus the link policy, on the live
// site. Each filter is checked by driving the real control and reading what
// survived — not by trusting that the element exists.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const { pinnedPage } = require("./clock.cjs");
// NOT named URL: that shadows the global URL constructor, so every
// `new URL(...)` below throws and this file silently mis-reports the feed.
const SITE = process.argv[2] || "https://datebook.indigokarasu.com/";
let fails = 0;
const check = (l, ok, d = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? `  [${d}]` : ""}`);
  if (!ok) fails++;
};
const chipByLabel = (page, group, re) =>
  page.locator(`#${group} .chip`).filter({ hasText: re }).first();

(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await pinnedPage(b, { viewport: { width: 1280, height: 1200 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(SITE, { wait_until: "networkidle" });
  await page.waitForSelector(".row", { timeout: 20000 });

  const total = await page.locator(".row").count();
  console.log(`\n== baseline ==\n  listings: ${total}`);

  console.log("\n== type filter ==");
  const feed0 = await page.evaluate(async () => (await (await fetch("events.json")).json()).events);
  // Chips are hidden while the filter bar is collapsed, so the click has to
  // happen after opening it. The bar starts closed by default at every width.
  await page.click("#ftoggle");
  await page.waitForTimeout(350);
  const typeChip = await page.locator("#f-type .chip").first();
  const typeLabel = (await typeChip.innerText()).replace(/\s+/g, " ").trim();
  // The chip label carries a count suffix, so strip it to get the bare type.
  const typeName = typeLabel.replace(/\d+$/, "").trim();
  // The expected set must be filtered through the SAME rule the page applies.
  // The page hides listings that have already started, judged against the
  // BROWSER's clock (that is the feature — it respects the reader's own
  // device), so a count derived from the raw feed compares a filtered page
  // against an unfiltered oracle. That is why this assertion only ever failed
  // late in the evening: by then a listing had begun and the page correctly
  // dropped it while the oracle still expected it.
  //
  // The oracle is built by asking the page what it considers visible, so the
  // two sides cannot drift apart again.
  const vis = await page.evaluate(async () => {
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return {
      nowMin, today,
      visible: (await (await fetch("events.json")).json()).events
        .filter((e) => e.date !== today || !(Number(e.startMinutes) >= 0 && Number(e.startMinutes) < nowMin))
        .map((e) => e.id),
    };
  });
  const visibleIds = new Set(vis.visible);
  const wantIds = new Set(
    feed0.filter((e) => e.categories.includes(typeName) && visibleIds.has(e.id)).map((e) => e.id));
  console.log(`  pinned clock: ${vis.today} ${Math.floor(vis.nowMin / 60)}:${String(vis.nowMin % 60).padStart(2, "0")}, ${visibleIds.size} of ${feed0.length} listings visible`);
  await typeChip.click();
  await page.waitForTimeout(300);
  const nType = await page.locator(".row").count();
  const gotIds = await page.evaluate(() =>
    [...document.querySelectorAll(".row")].map((r) => r.dataset.id).filter(Boolean));
  check("type filter narrows the list", nType < total, `${typeName} → ${nType}`);
  // Compare against the feed by id: the row markup carries several tag types,
  // so reading the DOM's tag text proves nothing about which one was filtered.
  check("shown rows are exactly the rows with that type",
    gotIds.length === wantIds.size && gotIds.every((id) => wantIds.has(id)),
    `${gotIds.length} shown / ${wantIds.size} expected`);
  await page.locator("#reset").click();
  await page.waitForTimeout(250);
  check("reset restores all", (await page.locator(".row").count()) === total);

  console.log("\n== price filter ==");
  const freeChip = await chipByLabel(page, "f-price", /^Free/);
  await freeChip.click();
  await page.waitForTimeout(300);
  const nFree = await page.locator(".row").count();
  // The free badge is a `.time-price.free` element whose parent is the ROW
  // itself — it is a sibling of the time column, not a child of it. An earlier
  // version of this assertion looked for `.time-col .price`, which matches
  // nothing at all: a layout change moved the badge out of `.time-col` and the
  // selector was never updated. It reported "0 badges" for 31 free rows and
  // read like the free filter was broken, when every free row was labelled
  // correctly the whole time. A selector that matches nothing is the failure
  // mode worth guarding against, so the count is compared against the number
  // of rows that should HAVE one — 0 vs 31 is unmistakably wrong, whereas
  // "0 vs 0" would have passed silently.
  const freeBadges = await page.evaluate(() =>
    [...document.querySelectorAll(".row")].filter((r) => {
      const b = r.querySelector(".row > .time-price.free");
      return !!b;
    }).length);
  check("price=Free narrows", nFree < total, `${nFree} free`);
  check("every Free-filtered row shows a free badge", freeBadges === nFree,
    `${freeBadges} badges / ${nFree} rows`);
  await page.locator("#reset").click();
  await page.waitForTimeout(250);

  console.log("\n== venue filter ==");
  const opts = await page.locator("#f-venue option").allTextContents();
  const venue = opts.find((v) => v && v !== "All venues");
  await page.selectOption("#f-venue", venue);
  await page.waitForTimeout(300);
  const venues = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll(".row .venue")].map((v) => v.textContent))]);
  check("venue filter narrows", (await page.locator(".row").count()) < total, venue);
  check("only the chosen venue remains", venues.length === 1 && venues[0] === venue, venues.join(","));
  await page.locator("#reset").click();
  await page.waitForTimeout(250);

  console.log("\n== link policy ==");
  const tiers = await page.evaluate(() => {
    const c = {};
    for (const s of document.querySelectorAll(".dest"))
      c[s.dataset.tier] = (c[s.dataset.tier] || 0) + 1;
    return c;
  });
  console.log(`  tiers: ${JSON.stringify(tiers)}`);
  const feed = await page.evaluate(async () => (await (await fetch("events.json")).json()).events);
  const agg = feed.filter((e) => (e.linkTier || "listing") === "listing");
  const direct = feed.filter((e) => e.linkTier === "venue" || e.linkTier === "boxoffice");
  check("most listings reach a first-party page", direct.length > agg.length * 2,
    `${direct.length} direct vs ${agg.length} fallback`);
  // No link may point at a redirector — those break silently. The pattern is
  // anchored to the whole HOST with the subdomain prefix optional. An unanchored
  // `t.co` also matches "terrorvault.com"; a `^(.|\.)` prefix fails to match a
  // bare "bit.ly" at all, so it would pass a feed full of shorteners.
  const REDIRECTORS =
    /^(.+\.)?(bit\.ly|pxf\.io|t\.co|lnkd\.in|goo\.gl|ow\.ly|is\.gd|buff\.ly|tinyurl\.com|cutt\.ly|t\.ly)$/i;
  const redirs = feed.filter((e) => {
    try {
      return REDIRECTORS.test(new URL(e.url).hostname);
    } catch {
      return true; // an unparseable URL is itself a failure
    }
  });
  check("no redirector links", redirs.length === 0, redirs.map((e) => e.url).join(" "));
  // Every row must actually link somewhere.
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll(".row .title-e")].map((a) => a.href));
  check("every row links out", hrefs.length > 0 && hrefs.every((h) => /^https?:/.test(h)),
    `${hrefs.length} links`);
  check("links are rel=noopener", await page.evaluate(() =>
    [...document.querySelectorAll(".row .title-e")].every((a) => (a.rel || "").includes("noopener"))));

  console.log("\n== window ==");
  const days = [...new Set(feed.map((e) => e.date))].sort();
  check("exactly three days", days.length === 3, days.join(", "));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  check("window starts today, SF time", days[0] === today, `${days[0]} vs ${today}`);

  console.log("\n== hygiene ==");
  check("no JS errors", errors.length === 0, errors.join("; "));
  await b.close();
  console.log();
  console.log(fails ? `${fails} FAILED` : "ALL GOOD");
  process.exit(fails ? 1 : 0);
})();
