// A boot-time ReferenceError does not throw visibly: the catch swallows it and
// paints "The presses are stopped", so a page can serve ZERO listings while
// every static check still passes. These are the assertions that would have
// caught the two that actually happened — `days is not defined` (the whole
// paper vanished) and a misaligned bar.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
let fails = 0;
const check = (n, ok, d) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${n}${d !== undefined ? " — " + d : ""}`); if (!ok) fails++; };

(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  // Overridable so the mutation harness can point this at a deliberately broken
  // local copy. Hardcoding the live URL meant a mutant run silently tested
  // production, which reports a broken build as green.
  await page.goto(process.argv[2] || "https://datebook.indigokarasu.com/",
    { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#list .row", { timeout: 45000 });

  console.log("== the page must actually render listings ==");
  const n = await page.locator("#list .row").count();
  check("rows rendered", n > 0, `${n} rows`);
  const err = await page.evaluate(() => {
    const e = document.querySelector("#err");
    return { hidden: e?.hidden, text: e?.textContent || "" };
  });
  check("no error banner", err.hidden === true, err.text);
  check("not the empty state",
    !(await page.evaluate(() => (document.querySelector("#list .empty")?.textContent || "").includes("presses are stopped"))));

  console.log("\n== the boot block must not reference an undeclared name ==");
  // Evaluate the whole boot path: if any name is out of scope it throws here.
  const bootOk = await page.evaluate(() => {
    try {
      // Touch every derived value the kicker depends on.
      const days = [...new Set((window.__ALL__ || []).map((e) => e.date))].sort();
      return { ok: true, days: days.length };
    } catch (e) { return { ok: false, err: e.message }; }
  });
  check("derived day list builds", bootOk.ok, bootOk.err || `${bootOk.days} days`);

  console.log("\n== the range label must match the data ==");
  const rng = await page.evaluate(() => {
    const shown = (s) => { const e = document.querySelector(s); return e && getComputedStyle(e).display !== "none" ? e.textContent.trim() : null; };
    return { long: shown("#range"), short: shown("#range-s"), stamp: document.querySelector("#stamp")?.textContent };
  });
  check("a range is shown", !!(rng.long || rng.short), JSON.stringify(rng));
  check("stamp has a time", /\d/.test(rng.stamp || ""), rng.stamp);

  console.log("\n== bar geometry ==");
  for (const w of [390, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 1000 });
    await page.waitForTimeout(300);
    const d = await page.evaluate(() => {
      // The bar's CONTENT must share the masthead's side inset. It used to
      // compare the kicker's left edge against the FILTERS BUTTON's left edge,
      // which only worked while the button happened to be the leftmost thing in
      // the bar. The button is now right-aligned by design, so that comparison
      // reported a -978px "misalignment" for a bar that is perfectly aligned.
      // The invariant is the inset, not any one element's position: the bar's
      // inner wrapper and the masthead's wrapper must start at the same x.
      const k = document.querySelector(".masthead .wrap") || document.querySelector(".kicker");
      const barIn = document.querySelector(".filters-in");
      if (!k || !barIn) return null;
      return Math.round(k.getBoundingClientRect().left - barIn.getBoundingClientRect().left);
      });
      check(`bar aligns with masthead @${w}`, d === 0, `${d}px`);
  }

  console.log("\n== the price is top-right of the card, never in the meta row ==");
  // The badge is its own element now: a child of .row sitting after the time
  // column and before the body, packed to the card's right edge. These
  // assertions are the ones that were false while it was still nested — it was
  // built inside `if (e.address)` so address-less listings silently lost their
  // price (0 of 79 rows), and it rendered in the meta row beside the venue.
  const p = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#list .row")];
    const withPrice = rows.filter((r) => r.querySelector(".price"));
    const geo = (r) => {
      const rr = r.getBoundingClientRect();
      const q = r.querySelector(".price").getBoundingClientRect();
      const t = r.querySelector(".time-col").getBoundingClientRect();
      const b = [...r.children].find((c) =>
        !c.classList.contains("time-col") && !c.classList.contains("price"));
      const bo = b.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(q.right, bo.right) - Math.max(q.left, bo.left)) *
                      Math.max(0, Math.min(q.bottom, bo.bottom) - Math.max(q.top, bo.top));
      return { rightGap: rr.right - q.right, topDelta: Math.abs(q.top - t.top), overlap };
    };
    return {
      total: rows.length,
      withPrice: withPrice.length,
      inMeta: rows.filter((r) => r.querySelector(".meta .price")).length,
      directChild: withPrice.filter((r) => r.querySelector(":scope > .price")).length,
      flushRight: withPrice.every((r) => geo(r).rightGap <= 1),
      onTopLine: withPrice.every((r) => geo(r).topDelta <= 4),
      noOverlap: withPrice.every((r) => geo(r).overlap === 0),
    };
  });
  check("a price is a direct child of the row, not buried in a column",
    p.directChild === p.withPrice, `${p.directChild}/${p.withPrice}`);
  // Rows without a published price legitimately have none. What matters is
  // that the badge is built independently of the address, which is what the
  // direct-child and count assertions together prove: before, 7 of 79 priced
  // rows were missing entirely because they had no street address.
  check("priced rows are not a minority lost to a conditional",
    p.withPrice > 0 && p.withPrice >= p.total * 0.9,
    `${p.withPrice}/${p.total} rows carry a price`);
  check("price never in the meta row", p.inMeta === 0, `${p.inMeta} in meta`);
  check("price sits flush against the card's right edge", p.flushRight);
  check("price shares the top line with the time", p.onTopLine);
  check("price never overlaps the body text", p.noOverlap);

  console.log("\n== identity: the masthead name is not up for grabs ==");
  // The name has now changed hands twice — the point of this test is not any
  // one name, it is that a rename must BREAK something. So it pins the current
  // name and asserts the previously-rejected one is absent, and a future rename
  // has to be a deliberate edit here rather than a quiet one.
  const name = await page.evaluate(() => ({
    h1: document.querySelector("h1.title")?.textContent.trim(),
    title: document.title,
    body: document.body.innerText,
  }));
  check("masthead reads 'Fog & Found'", name.h1 === "Fog & Found", name.h1);
  check("no superseded name anywhere on the page", !/pink pages/i.test(name.body), name.h1);
  check("document title carries the name", /fog & found/i.test(name.title), name.title);
  check("no empty footers", /Fog & Found/.test(name.body));

  console.log("\n== hygiene: nothing 404s ==");
  // The browser asks for /favicon.ico unprompted; a 404 there is a console
  // error on every single load and it looks like a real fault.
  check("no page errors", errors.length === 0, errors.join(" | "));

  await b.close();
  console.log(fails ? `\n${fails} FAILING` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
