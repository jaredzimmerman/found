// Masonry + halftone: geometry and effect, measured in a real browser.
// Asserts the COLUMN COUNT at each breakpoint (which a screenshot cannot prove)
// and that the filter is actually applied to rendered images.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const { pinnedPage, PINNED } = require("./clock.cjs");
// Overridable so the mutation harness can point this at a deliberately broken
// local copy. Hardcoding the live URL made every mutant run silently test
// production instead, which reported the broken build as green.
const SITE = process.argv[2] || "https://datebook.indigokarasu.com/";
let fails = 0;
const check = (l, ok, d) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`);
  if (!ok) fails++;
};

(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await pinnedPage(b, { viewport: { width: 1440, height: 1000 } });
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  // `domcontentloaded`, not `networkidle`: the site keeps polling for network
  // activity, so `networkidle` waits for a connection that never settles and
  // the test hangs for its full timeout. The DOM is what the assertions read.
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#list .row", { timeout: 25000 });

  // Column count, measured from real card positions — not read off the CSS.
  const columnsAt = async (w) => {
    await page.setViewportSize({ width: w, height: 1000 });
    await page.waitForTimeout(450);
    return page.evaluate(() => {
      // Measure across EVERY day-list, not just the first. The first day's
      // section can legitimately hold a single evening listing when the pinned
      // clock sits at noon, so scoping to `document.querySelector` measured a
      // one-card section and reported the masonry as a single column. The
      // layout being tested is the one holding the bulk of the cards.
      const cards = [...document.querySelectorAll(".day-list .row")];
      if (!cards.length) return { cols: 0, n: 0, xcount: 0 };
      // Group cards by their rounded x offset: each distinct left edge is a
      // column. This is layout truth, independent of the stylesheet.
      const xs = [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left)))];
      return { cols: xs.length, n: cards.length, xcount: xs.length };
    });
  };

  console.log("== masonry: 2 columns on a laptop, 3 on a wide screen, 1 on a phone ==");
  // Guard the fixture before trusting any card count. A pinned instant that
  // falls BEHIND the feed's window makes hasPassed() hide every listing, and
  // every geometry assertion below then measures an empty list and reports the
  // layout as broken. That happened: the pin was hardcoded to a date the feed
  // had already rolled past, and three suites went red for a calendar, not a
  // defect. If this ever fails, fix clock.cjs — do not relax the assertions.
  const win = await page.evaluate(async () => {
    const d = await (await fetch("events.json")).json();
    return [...new Set(d.events.map((e) => e.date))].sort();
  });
  const pinDay = PINNED.toISOString().slice(0, 10);
  check(`the pinned clock sits inside the feed window (${pinDay})`,
    win.includes(pinDay), `feed days: ${win.join(", ")}`);

  const wide = await columnsAt(1440);
  check("3 columns @1440", wide.cols === 3, JSON.stringify(wide));
  const laptop = await columnsAt(1000);
  check("2 columns @1000", laptop.cols === 2, JSON.stringify(laptop));
  const phone = await columnsAt(390);
  check("1 column @390", phone.cols === 1, JSON.stringify(phone));

  console.log("\n== every day section is its own masonry run ==");
  const perDay = await page.evaluate(() =>
    [...document.querySelectorAll(".day")].map((d) => ({
      lists: d.querySelectorAll(".day-list").length,
      cards: d.querySelectorAll(".row").length,
    })));
  check("each day has exactly one .day-list",
    perDay.every((d) => d.lists === 1), JSON.stringify(perDay));
  check("no card was orphaned out of a .day-list",
    await page.evaluate(() => document.querySelectorAll("#list .row").length) ===
    await page.evaluate(() => document.querySelectorAll(".day-list .row").length));

  console.log("\n== masonry must not clip or straddle ==");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(400);
  const geo = await page.evaluate(() => {
    const list = document.querySelector(".day-list");
    const lr = list.getBoundingClientRect();
    const bad = [];
    for (const c of list.querySelectorAll(".row")) {
      const r = c.getBoundingClientRect();
      if (r.left < lr.left - 1 || r.right > lr.right + 1) bad.push("outside");
      if (r.width <= 0) bad.push("zero width");
    }
    return bad;
  });
  check("no card overflows its column", geo.length === 0, geo.join(","));

  // Vertical overlap would mean two cards in one column are on top of each other.
  const overlap = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".day-list")[0].querySelectorAll(".row")]
      .map((c) => c.getBoundingClientRect());
    let bad = 0;
    for (let i = 0; i < cards.length; i++)
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i], c = cards[j];
        const sameCol = Math.abs(a.left - c.left) < 4;
        if (sameCol && a.top < c.bottom - 1 && c.top < a.bottom - 1) bad++;
      }
    return bad;
  });
  check("no two cards overlap in a column", overlap === 0, `${overlap} overlaps`);

  console.log("\n== the dot screen is applied, and the images actually loaded ==");
  // A computed style is not evidence that a filter RAN. The previous version
  // asserted `filter: url(#halftone)` on every image and the whole 7-screen
  // chain existed in the DOM — and the cards were still blank white, because
  // Chromium never loads an external dot table into feImage. Style and DOM
  // checks passed; the pixels were empty. So the assertion that matters is
  // pixel-based: does the card contain a photograph, and does it contain a
  // high-frequency dot lattice that survives at the size it is shown?
  const imgs = await page.evaluate(async () => {
    const els = [...document.querySelectorAll(".figure img")];
    // Decode with a hard cap: a stuck image must not hang the whole suite.
    await Promise.all(els.map((i) => Promise.race([
      i.complete ? null : i.decode().catch(() => {}),
      new Promise((r) => setTimeout(r, 4000)),
    ])));
    return {
      n: els.length,
      screened: els.filter((i) => {
        const f = getComputedStyle(i).filter;
        return f && f !== "none";
      }).length,
      loaded: els.filter((i) => i.naturalWidth > 0).length,
      badSrc: els.filter((i) => !/^https:\/\//.test(i.currentSrc || i.src)).length,
      screen: !!document.querySelector(".figure") &&
        getComputedStyle(document.querySelector(".figure"), "::after").backgroundImage.includes("radial-gradient"),
    };
  });
  check("images are rendered", imgs.n > 0, `${imgs.n} figures`);
  check("every image carries a monochrome filter",
    imgs.n > 0 && imgs.screened === imgs.n, `${imgs.screened}/${imgs.n}`);
  check("the dot screen is on .figure::after", imgs.screen);
  // Every image in the document must be a real, decodable photograph. This is
  // the assertion that actually catches a broken src: naturalWidth is 0 for an
  // image the browser could not decode, whether it 404'd, was an HTML error
  // page, or was a relative URL that resolved against the wrong base.
  //
  // The earlier version of this check (`loaded === 0 || loaded === n ||
  // badSrc === 0`) could not fail — badSrc is asserted on the next line, so any
  // value of `loaded` passed. A test that cannot fail is worse than no test: it
  // reports green while the thing it claims to cover is broken.
  //
  // Images are forced to load eagerly for the duration of the measurement so
  // that a below-the-fold image is still checked — a lazy card is not exempt
  // from being a real image.
  const bad = await page.evaluate(async () => {
    const els = [...document.querySelectorAll(".figure img")];
    els.forEach((i) => { i.loading = "eager"; });
    await Promise.all(els.map((i) => Promise.race([
      i.decode().catch(() => {}),
      new Promise((r) => setTimeout(r, 6000)),
    ])));
    return els
      .filter((i) => i.naturalWidth === 0)
      .map((i) => (i.currentSrc || i.src || "(no src)").slice(0, 110));
  });
  check("every image is a real, decodable photograph", bad.length === 0,
    bad.length ? `${bad.length} broken: ${bad.slice(0, 2).join(" | ")}` : `${imgs.n} images, 0 broken`);
  check("every image src is absolute https", imgs.badSrc === 0, `${imgs.badSrc} bad`);

  // Pixel truth, measured on a real card at the real width.
  const card = page.locator(".figure").first();
  const shot = await card.screenshot();
  const px = require("/usr/local/lib/hermes-agent/node_modules/pngjs");
  const png = px.PNG.sync.read(shot);
  const greys = [];
  for (let i = 0; i < png.data.length; i += 4) {
    greys.push(0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2]);
  }
  const mean = greys.reduce((a, b) => a + b, 0) / greys.length;
  const sd = Math.sqrt(greys.reduce((a, b) => a + (b - mean) ** 2, 0) / greys.length);
  const uniq = new Set(greys.map((g) => Math.round(g))).size;
  check("the card is not blank (a blank card is a silent filter failure)",
    uniq > 40, `${uniq} distinct greys, sd ${sd.toFixed(1)}`);
  check("the card holds a real tonal range", sd > 12, `sd ${sd.toFixed(1)}`);

  console.log("\n== the screen overlay is inside the card, not over the text ==");
  // The screen is a ::after on .figure. It must be clipped by the card and
  // stacked above the photo. The text lives OUTSIDE .figure, so a screen that
  // escaped its box would print dots across the headline.
  const over = await page.evaluate(() => {
    const f = document.querySelector(".figure");
    const a = getComputedStyle(f, "::after");
    return {
      blend: a.mixBlendMode,
      pos: getComputedStyle(f).position,
      inset: [a.top, a.right, a.bottom, a.left].join(" "),
      overflow: getComputedStyle(f).overflow,
      bg: a.backgroundImage.slice(0, 30),
    };
  });
  check("the screen multiplies over the photo", over.blend === "multiply", over.blend);
  check("the card is the positioning context", over.pos === "relative", over.pos);
  check("the card clips its screen", over.overflow === "hidden", over.overflow);
  check("the screen is laid out on the card", /^0px/.test(over.inset), over.inset);
  check("the screen is a dot pattern", over.bg.includes("radial-gradient"), over.bg);

  // The dot geometry, measured as RENDERED rather than as declared. --dot-r is
  // the radius inside the gradient and --dot-cell the lattice pitch; both must
  // actually reach the pseudo-element, and the radius must be strictly smaller
  // than the pitch (a radius at or past the pitch is a solid block, not a
  // screen). This is the check that would have caught the radius sitting
  // unchanged at 1.05px while a comment claimed it had been reduced.
  // `getComputedStyle` on a background-image RESOLVES var() references, so
  // the computed value never contains the literal string "var(--dot-r)". Asking
  // whether the computed gradient mentions the variable therefore fails even
  // when the variable is wired up correctly. The variable's effect is instead
  // proven by the radius measurement itself: the rendered gradient's stop
  // positions must match the declared --dot-r.
  const dot = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const a = getComputedStyle(document.querySelector(".figure"), "::after");
    const px = (v) => parseFloat(v) || 0;
    // Pull the first gradient colour-stop's END position out of the resolved
    // background-image; that is the effective dot radius.
    const stops = [...a.backgroundImage.matchAll(/rgba?\([^)]*\)\s+([\d.]+)px/g)].map((m) => px(m[1]));
    return {
      r: px(cs.getPropertyValue("--dot-r")),
      cell: px(a.backgroundSize),
      stop: stops.length ? Math.max(...stops) : 0,
    };
  });
  check("the dot radius reaches the screen",
    dot.r > 0 && dot.stop > 0 && Math.abs(dot.stop - dot.r) < 0.35,
    `--dot-r ${dot.r}px, gradient stops at ${dot.stop}px`);
  check("the screen pitch is a real lattice", dot.cell > 0, `${dot.cell}px`);
  check("the dots are smaller than their cell (a screen, not a slab)",
    dot.r > 0 && dot.r < dot.cell, `r=${dot.r} < cell=${dot.cell}`);
  // The request was explicitly "make the dots smaller". Pin the ceiling so a
  // later edit cannot quietly put them back: 0.7px radius on a 3px pitch.
  check("the dots are the reduced size that was asked for",
    dot.r <= 0.8, `r=${dot.r}px (must be <= 0.8px)`);

  // Hover must return the photograph to full colour and remove the screen.
  // Driven with a REAL pointer hover of the CARD (the article.row, not the
  // image) — the user asked for the transition to happen anywhere on the card,
  // so the test must hover the card's text block and confirm the image reacts.
  //
  // Driven with a real pointer hover, not by reading the rule out of the
  // stylesheet: a rule can exist and still be overridden or dead, and reading
  // the CSS only proves the author typed something. Reuses `card`, the same
  // locator the pixel measurement above already resolved.
  const atRest = await card.evaluate((f) => ({
    filter: getComputedStyle(f.querySelector("img")).filter,
    screen: getComputedStyle(f, "::after").opacity,
  }));
  check("the resting image is screened to monochrome",
    /grayscale/.test(atRest.filter) && parseFloat(atRest.screen) > 0,
    `${atRest.filter} / screen ${atRest.screen}`);

  // The card, not the figure: the user asked for the transition to happen
  // anywhere on the card, so the test has to hover the card's TEXT and confirm
  // the image inside it reacts. `row` is the <article>; `figure` is the image
  // wrapper within it. A real pointer hover, not a stylesheet read — a rule
  // can exist and still be overridden or dead.
  const row = page.locator(".row").filter({ has: page.locator(".figure img") }).first();
  await row.locator(".title-e").first().hover();
  await page.waitForTimeout(400); // past the 180ms transition
  const onHover = await row.evaluate((f) => ({
    filter: getComputedStyle(f.querySelector(".figure img")).filter,
    screen: getComputedStyle(f.querySelector(".figure"), "::after").opacity,
  }));
  check("hovering the card's TEXT (not the image) restores full colour",
    /none/i.test(onHover.filter) || !/grayscale/.test(onHover.filter),
    `atRest ${atRest.filter} -> ${onHover.filter}`);
  check("hovering the card's TEXT fades the dot screen out",
    parseFloat(onHover.screen) === 0, `screen ${atRest.screen} -> ${onHover.screen}`);

  // Move the pointer off the card before reading the resting curve. The hover
  // rule sets filter:none, so a curve read while hovered measures the wrong
  // element state — that is what made every curve assertion below report
  // "contrast null" and then conclude the artwork was crushed.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(350);

  // The contrast curve is bounded by measurement, not taste. The feed's
  // artwork is dark (sampled: mean luma 9-108, median 48) and CSS contrast
  // pivots about 127.5, so an aggressive boost drives the median card to solid
  // black — a flat rectangle the dot screen has nothing to print. This asserts
  // the curve against that measured distribution so the number cannot drift
  // back to a value that silently flattens the photographs.
  const curve = await page.evaluate(() => {
    const f = getComputedStyle(document.querySelector(".figure img")).filter;
    const num = (re) => { const m = f.match(re); return m ? Number(m[1]) : null; };
    return { raw: f, c: num(/contrast\(([\d.]+)\)/), br: num(/brightness\(([\d.]+)\)/) };
  });
  // Apply the curve exactly as CSS does, then count how many reference cards
  // land in the black clip. The threshold is the measured knee, not a guess:
  // two of the six sampled luma are near-black in the source artwork and no
  // honest curve rescues them, so the assertion permits exactly those two and
  // fails the moment a fourth is clipped.
  const cssContrast = (v, c) => Math.max(0, Math.min(255, (v - 127.5) * c + 127.5));
  const cssBright = (v, b) => Math.max(0, Math.min(255, v * b));
  const SAMPLED = [9.4, 20.0, 32.7, 48.3, 65.1, 107.9];
  const crushed = SAMPLED.filter((v) => cssBright(cssContrast(v, curve.c), curve.br) < 6).length;
  const remaining = SAMPLED.filter((v) => cssBright(cssContrast(v, curve.c), curve.br) >= 6);
  check("the curve is set and finite", Number.isFinite(curve.c) && curve.c > 0, curve.raw);
  check("the curve does not crush the artwork to black",
    crushed <= 2, `${crushed}/${SAMPLED.length} reference luma clipped (contrast ${curve.c}, brightness ${curve.br})`);
  // The cards that survive must still hold a range the dot screen can print in,
  // otherwise the halftone silently degrades to a flat grey rectangle.
  check("surviving cards keep a printable tonal range",
    remaining.length > 0 && Math.max(...remaining) - Math.min(...remaining) > 25,
    remaining.map((v) => v.toFixed(0)).join(","));
  check("the curve still snaps toward newsprint", curve.c >= 1.15, `${curve.c}`);

  console.log("\n== hygiene ==");
  check("no console errors", errs.length === 0, errs.slice(0, 2).join(" | "));

  await b.close();
  console.log(fails ? `\n${fails} FAILING` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
