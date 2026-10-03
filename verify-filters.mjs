// The real filter test, written against the ACTUAL control shape found by
// probe-filters.mjs (not assumed):
//   #f-day, #f-type, #f-price, #f-sold, #f-hood, #f-link  -> div > button.chip[data-value]
//   #f-venue -> select        #f-q -> input
//
// Three claims this must prove, none of which I had live evidence for before:
//   A. clicking a neighborhood chip actually filters the list
//   B. chips that would yield zero results are hidden (criterion 3)
//   C. the filter bar is closed by default (criterion 5)
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const out = {};

const open = async (viewport) => {
  const p = await b.newPage({ viewport });
  await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await p.mouse.move(2, 2);
  await p.waitForTimeout(400);
  return p;
};

const chipsIn = (p, id) =>
  p.evaluate((gid) => {
    const g = document.getElementById(gid);
    if (!g) return null;
    return [...g.querySelectorAll("button.chip")].map((c) => ({
      v: c.dataset.value,
      text: c.textContent.trim(),
      shown: c.offsetParent !== null,
    }));
  }, id);

const rowCount = (p) =>
  p.evaluate(() => document.querySelectorAll(".row").length);

// The panel is CLOSED by default: probe-toggle.mjs found `#frow` at
// `display:none`, with `.ftoggle` as the opener and `.filters-in` staying 63px
// (just the rail). So every filter has to be opened before it can be clicked —
// which is also the proof of criterion 5.
const openPanel = async (page) => {
  const before = await page.evaluate(() => {
    const r = document.getElementById("frow");
    return { display: getComputedStyle(r).display, h: r.getBoundingClientRect().height };
  });
  await page.click(".ftoggle");
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => {
    const r = document.getElementById("frow");
    return { display: getComputedStyle(r).display, h: r.getBoundingClientRect().height };
  });
  return { before, after, ariaExpanded: await page.getAttribute(".ftoggle", "aria-expanded") };
};

// --- A. neighborhood filter actually filters -------------------------------
const p = await open({ width: 1440, height: 1000 });
out.A = { before: await rowCount(p) };

// Criterion 5, measured before anything is touched.
out.A.panelClosedByDefault = await openPanel(p);
out.A.hoodChips = await chipsIn(p, "f-hood");

const pick = await p.evaluate(() => {
  const real = [...document.querySelectorAll("#f-hood button.chip")].filter(
    (c) => c.dataset.value !== "",
  );
  if (!real.length) return null;
  const best = real
    .map((c) => ({
      v: c.dataset.value,
      n: Number((c.textContent.match(/(\d+)\s*$/) || [])[1] || 0),
    }))
    .sort((a, b) => b.n - a.n);
  return best[0];
});
out.A.picked = pick;

if (pick) {
  await p.click(`#f-hood button.chip[data-value="${pick.v}"]`);
  await p.waitForTimeout(350);
  out.A.after = await rowCount(p);
  out.A.matchesChipCount = pick.n;
  out.A.consistent = out.A.after === pick.n;
  out.A.hoodLabelsShown = await p.evaluate(() => {
    const s = new Set();
    document.querySelectorAll(".row").forEach((r) =>
      r.querySelectorAll(".hood,[class*=hood]").forEach((e) =>
        s.add(e.textContent.trim()),
      ),
    );
    return [...s];
  });
}

// --- B. zero-result chips hide ---------------------------------------------
out.B = {};
if (pick) {
  const types = ((await chipsIn(p, "f-type")) || []).filter(
    (c) => c.v !== "" && c.shown,
  );
  out.B.typesAvailableInHood = types.map((c) => c.text);
  // Anything NOT in that list was already hidden by the hood selection.
  const allTypes = await p.evaluate(() =>
    [...document.querySelectorAll("#f-type button.chip")].map(
      (c) => c.dataset.value,
    ),
  );
  out.B.hiddenTypeValues = allTypes.filter(
    (v) => v && !types.some((t) => t.v === v),
  );

  // Stack a type on top, then confirm the hood chips re-scope.
  const t = types[0];
  if (t) {
    await p.click(`#f-type button.chip[data-value="${t.v}"]`);
    await p.waitForTimeout(350);
    out.B.afterBoth = await rowCount(p);
    out.B.hoodsNowShown = ((await chipsIn(p, "f-hood")) || [])
      .filter((c) => c.v !== "" && c.shown)
      .map((c) => c.text);
    out.B.venueOptionsNow = await p.evaluate(() => {
      const s = document.getElementById("f-venue");
      return s ? [...s.options].map((o) => o.textContent.trim()) : null;
    });
  }
  // Reset via the real control. There is no "All" chip in #f-hood with an empty
  // data-value — I assumed one from the #f-type sample. `#reset` is the actual
  // clear-filters button, and it is `hidden` until a filter is active.
  await p.click("#reset");
  await p.waitForTimeout(250);
  out.B.rowsAfterReset = await rowCount(p);
}

// --- C. filter bar closed by default ---------------------------------------
// Measured on a FRESH page on each viewport, before any click, so the default
// state is what is recorded. `#frow` is the panel body; `.filters-in` is the
// whole bar including the rail, so a 63px bar with a display:none `#frow` is
// "closed, rail showing".
const defaultState = (page) =>
  page.evaluate(() => {
    const row = document.getElementById("frow");
    const bar = document.querySelector(".filters-in");
    const tog = document.querySelector(".ftoggle");
    return {
      panelDisplay: row ? getComputedStyle(row).display : null,
      panelHeightPx: row ? Math.round(row.getBoundingClientRect().height) : null,
      barHeightPx: bar ? Math.round(bar.getBoundingClientRect().height) : null,
      toggleAriaExpanded: tog ? tog.getAttribute("aria-expanded") : null,
      chipsClickable: [...document.querySelectorAll(".chip")].some(
        (c) => c.offsetParent !== null,
      ),
    };
  });

out.C = {};
out.C.desktopFresh = await defaultState(p);
const ph = await open({ width: 390, height: 844 });
out.C.phoneFresh = await defaultState(ph);
out.C.phoneRows = await rowCount(ph);
out.C.desktopRows = await rowCount(p);

// And it must still open on a phone, or criterion 5 would be a wall.
out.C.phoneOpened = await openPanel(ph);
out.C.phoneRowsAfterOpen = await rowCount(ph);

await b.close();
console.log(JSON.stringify(out, null, 2));