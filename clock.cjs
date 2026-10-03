// Pin the browser clock for the test suite.
//
// The page hides events that have already started, using the BROWSER's clock
// (that is the feature: it respects the reader's own device). That makes every
// rendered-card count a function of wall-clock time. A suite that counts cards
// is therefore only reproducible if the clock is fixed — otherwise the same
// commit "fails" at 8pm (today's section has drained) and "passes" at 9am.
//
// The instant is DERIVED FROM THE FEED, not hardcoded. It used to be pinned to
// 2026-09-29T12:00 PDT on the assumption that the feed's first day was 09-29.
// When the feed rolled forward to 09-30/10-01 that instant fell a day BEHIND
// the window, so `hasPassed()` correctly hid every listing and the masonry
// suite measured one card in one column and called the layout broken. The
// assertion was fine; the fixture had gone stale.
//
// Noon on the feed's FIRST day is the right instant: every day section is
// populated, and nothing has started yet. If the feed is missing, fall back to
// a fixed date so a missing artifact fails loudly rather than hanging.
const { readFileSync, existsSync } = require("node:fs");

function pinnedInstant() {
  const feed = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/events.json";
  if (existsSync(feed)) {
    try {
      const { events = [] } = JSON.parse(readFileSync(feed, "utf8"));
      const days = [...new Set(events.map((e) => e.date))].sort();
      if (days.length) {
        const d = new Date(`${days[0]}T12:00:00-07:00`);
        if (!Number.isNaN(d.getTime())) return d;
      }
    } catch { /* fall through to the fixed default below */ }
  }
  return new Date("2026-09-29T12:00:00-07:00");
}

const PINNED = pinnedInstant();

async function pinnedPage(browser, opts = {}) {
  const ctx = await browser.newContext(opts);
  await ctx.clock.setFixedTime(PINNED);
  return ctx.newPage();
}

module.exports = { PINNED, pinnedPage, pinnedInstant };
