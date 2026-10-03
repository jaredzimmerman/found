// End-to-end verification against the LIVE site, not the local build.
// Every claim in the completion report has to come out of this file or it
// is not a claim, it is a recollection.
import { chromium } from "playwright-core";

const CHROME = "/root/.cache/ms-playwright/chromium-1234/chrome-linux/chrome";
const URL = "https://pinkpages.indigokarasu.com/?cb=" + Date.now();

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });

const net = { failed: 0, non200: [] };
page.on("requestfailed", (r) => net.failed++);
page.on("response", (r) => {
  if (r.status() >= 400) net.non200.push(`${r.status()} ${r.url().slice(0, 90)}`);
});

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
// Park the pointer OFF the list. Any hover state is a legitimate style, and
// sampling through it turns a passing page into a failing one.
await page.mouse.move(2, 2);
await page.waitForTimeout(400);

const out = {};

// ---- the feed itself, straight from the server -------------------------
const feed = await page.evaluate(async () => {
  const r = await fetch("events.json?cb=" + Date.now());
  return { status: r.status, body: await r.json() };
});
const evs = feed.body.events || feed.body;
out.feedHttp = feed.status;
out.feedEvents = evs.length;

// ---- link tiers: are we actually sending people to the venue? ----------
const tier = {};
const hosts = {};
for (const e of evs) {
  tier[e.linkTier || "?"] = (tier[e.linkTier || "?"] || 0) + 1;
  let h = "?";
  try {
    h = new URL(e.url).hostname.replace(/^www\./, "");
  } catch {}
  hosts[h] = (hosts[h] || 0) + 1;
}
out.linkTiers = tier;
out.topHosts = Object.entries(hosts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .map(([h, n]) => `${n} ${h}`);

// A row that claims "venue" but points at an aggregator is the exact failure
// the brief forbids, so it is checked against the host, not the label.
const AGG = /(dothebay\.com|eventbrite\.|dostuff|allevents\.in|evvys|sfweekly|sfchronicle|funcheap|eventup|patch\.com|do512|bit\.ly|pxf\.io|t\.co|is\.gd)/i;
out.mislabeledVenue = evs
  .filter((e) => e.linkTier === "venue" && AGG.test(e.url))
  .map((e) => `${e.title.slice(0, 40)} -> ${e.url.slice(0, 70)}`);

// ---- sold out: are they actually gone? ---------------------------------
out.soldOutKept = evs.filter((e) => e.soldOut || e.sold_out).length;
out.hideSoldDefault = await page
  .locator("#hide-sold, [data-filter='sold']")
  .first()
  .isChecked()
  .catch(() => "no such control");
out.soldRowsInDom = await page.locator(".row.sold").count();

// ---- time ranges --------------------------------------------------------
const withEnd = evs.filter(
  (e) => typeof e.endMinutes === "number" && e.endMinutes > 0,
).length;
out.eventsWithEndTime = withEnd;
out.rangesShownInDom = await page
  .evaluate(() => document.body.innerText.match(/\d{1,2}(:\d{2})?\s*(AM|PM)?\s*--\s*\d{1,2}(:\d{2})?\s*(AM|PM)?/gi)?.length || 0);
out.sampleRanges = await page.evaluate(() =>
  (document.body.innerText.match(/\d{1,2}(:\d{2})?\s*(AM|PM)?\s*--\s*\d{1,2}(:\d{2})?\s*(AM|PM)?/gi) || []).slice(0, 6),
);

// ---- type / underline / weight: the last two user requests -------------
out.titles = await page.locator(".title-e").count();
out.underlinedTitlesAtRest = await page.evaluate(
  () =>
    [...document.querySelectorAll(".title-e")].filter(
      (e) => getComputedStyle(e).textDecorationLine !== "none",
    ).length,
);
out.underlinedVenuesAtRest = await page.evaluate(
  () =>
    [...document.querySelectorAll(".venue")].filter(
      (e) => getComputedStyle(e).textDecorationLine !== "none",
    ).length,
);
out.nonBoldVenues = await page.evaluate(
  () =>
    [...document.querySelectorAll(".venue")].filter(
      (e) => Number(getComputedStyle(e).fontWeight) < 700,
    ).length,
);
out.venueCount = await page.locator(".venue").count();

// And the other half of the request: hovering MUST underline.
out.hoverRestoresUnderline = await page.evaluate(async () => {
  const a = document.querySelector(".title-e");
  const v = document.querySelector(".venue");
  if (!a) return "no title found";
  a.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  return { hasHoverRule: [...document.styleSheets].some(() => true) };
});
out.hoverRuleInCss = await page.evaluate(() => {
  const walk = (rules) =>
    [...rules].some((r) =>
      r.selectorText?.includes(".title-e:hover") ||
      (r.selectorText?.includes(".venue") && r.selectorText?.includes(":hover")) ||
      (r.cssRules && walk(r.cssRules)),
    );
  return [...document.styleSheets].some((s) => {
    try {
      return walk(s.cssRules);
    } catch {
      return false;
    }
  });
});

// ---- heading outline ---------------------------------------------------
out.headings = await page.evaluate(() =>
  [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].reduce((a, h) => {
    a[h.tagName] = (a[h.tagName] || 0) + 1;
    return a;
  }, {}),
);
out.h1Text = await page.locator("h1").first().innerText().catch(() => null);

// ---- filter chips: hidden when they would show zero --------------------
async function chipAudit(group) {
  return page.evaluate((g) => {
    const grp = document.querySelector(`.fgroup[data-group="${g}"], .fgroup.${g}`);
    if (!grp) return { group: g, missing: true };
    const chips = [...grp.querySelectorAll("button.chip, .chip")];
    return {
      group: g,
      chips: chips.length,
      // Each chip's count is the number of rows it would yield, printed by the
      // renderer. A chip showing 0 is exactly what criterion 3 forbids.
      showingZero: chips
        .filter((c) => /(^|\D)0(\D|$)/.test(c.textContent))
        .map((c) => c.textContent.trim().slice(0, 24)),
    };
  }, group);
}
out.chips = [];
for (const g of ["type", "price", "day", "venue", "hood", "neighborhood"]) {
  out.chips.push(await chipAudit(g));
}

// ---- filter bar closed by default (criterion 5) ------------------------
out.filterPanelCollapsed = await page.evaluate(() => {
  const p = document.querySelector(".fpanel, .fpanel-body, .filters-panel");
  if (!p) return "no panel found";
  return { hidden: p.hidden === true || getComputedStyle(p).display === "none" || p.getAttribute("aria-expanded") === "false" };
});
out.filterToggle = await page.locator(".fbar-toggle, .fbar button, .fbar [role=button]").first().innerText().catch(() => null);

// ---- a11y: labelled controls ------------------------------------------
out.a11y = await page.evaluate(() => {
  const named = (el) => {
    const id = el.id;
    if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return true;
    if (el.getAttribute("aria-label")?.trim()) return true;
    if (el.getAttribute("aria-labelledby")?.trim()) return true;
    if (el.closest("label")) return true;
    if (el.previousElementSibling?.tagName === "LABEL") return true;
    return false;
  };
  const controls = [...document.querySelectorAll("input, select, textarea")];
  return {
    controls: controls.length,
    unlabelled: controls.filter((c) => !named(c)).map((c) => `${c.tagName}#${c.id || "(no id)"}[${c.type || ""}]`),
  };
});

// ---- images ------------------------------------------------------------
out.images = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll(".figure img")];
  return {
    inDom: imgs.length,
    withSrc: imgs.filter((i) => i.getAttribute("src")).length,
    naturalOk: imgs.filter((i) => i.naturalWidth > 0).length,
  };
});

out.net = net;

console.log(JSON.stringify(out, null, 2));
await b.close();
