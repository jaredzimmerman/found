// Stub fetch.mjs body for tests/build-site.test.sh. The test prepends the real
// `const CATEGORIES = [...]` block from build/fetch.mjs (validate-feed.mjs reads
// the taxonomy from the fetch.mjs next to it).
//
// Env: STUB_FEED  path to tests/fixtures/feed-good.json
//      STUB_MODE  good (default) | bad (string categories) | fail (exit 1)
//                 | hang (never exits) | noreport (no .source-report.json)
//      STUB_SLEEP seconds to wait before writing (default 0)
// Writes ./.stub-started first, so the test can tell the fetch stage began.
import fs from "node:fs";

fs.writeFileSync(".stub-started", String(process.pid));
const mode = process.env.STUB_MODE || "good";
const sleep = Number(process.env.STUB_SLEEP || 0) * 1000;

function pacific(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function write() {
  if (mode === "fail") { console.error("stub fetch: simulated failure"); process.exit(1); }
  const feed = JSON.parse(fs.readFileSync(process.env.STUB_FEED, "utf8"));
  const now = Date.now();
  const days = [0, 1, 2].map((i) => pacific(new Date(now + i * 86400000)));
  const map = new Map(feed.days.map((d, i) => [d, days[i]]));
  feed.days = days;
  feed.generatedAt = new Date(now).toISOString();
  for (const e of feed.events) e.date = map.get(e.date) || days[0];
  if (mode === "bad") for (const e of feed.events.slice(0, 12)) { e.categories = e.categories[0]; }
  fs.writeFileSync("events.json", JSON.stringify(feed, null, 1));
  if (mode !== "noreport") {
    const n = feed.events.length;
    fs.writeFileSync(".source-report.json", JSON.stringify({
      generatedAt: feed.generatedAt,
      sources: { dothebay: { status: "ok", reason: null, registered: n, kept: n } },
      totals: { kept: n },
    }));
  }
  console.log(`Wrote ${feed.events.length} events`);
  console.log("every source fetch succeeded");
}

if (mode === "hang") setInterval(() => {}, 1 << 30);
else setTimeout(write, sleep);
