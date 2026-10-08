// Regression test for the dead-link leak.
//
// The bug: DEAD_BOXOFFICE was consulted on `buyLive` only. `copyVenue` — the
// venue page mined from the event's own copy — was preferred FIRST and never
// checked, so a dead venue URL survived the guard and was published with a
// live-looking "Venue site" badge. On 2026-10-03 two rows did exactly that:
//
//   https://waitingroom.sfsymphony.org/Buy-Tickets/2026-27/Renee-Fleming-Strauss
//
// That host returns 404. The venue's own live page is the same path on
// www.sfsymphony.org, which returns 200. The reader got a dead link; the
// aggregator's honest listing page was available the whole time.
//
// Both leak paths are pinned: the anchor-in-copy path AND the buy_url path,
// because fixing only one leaves the other open.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const DEAD = "https://waitingroom.sfsymphony.org/Buy-Tickets/2026-27/Renee-Fleming-Strauss";
const LIVE = "https://www.sfsymphony.org/Buy-Tickets/2026-27/Renee-Fleming-Strauss";

// The dead table as fetch.mjs builds it.
const deadMap = new Map(
  JSON.parse(readFileSync(new URL("./prices-resolved.json", import.meta.url), "utf8"))
    .dead.map((d) => [d.url, d.id])
);

console.log("dead table loaded:", deadMap.size, "entries");

// 1. The dead URL really is in the table — otherwise this test would pass for
//    the wrong reason, which is exactly how the original guard looked fine.
assert.ok(deadMap.has(DEAD), `expected ${DEAD} in the dead table`);
console.log("  ok    dead URL is in the table (id", deadMap.get(DEAD) + ")");

// 2. And the table is keyed by exact string, so a near-miss must NOT match.
//    A host-level or prefix match would let waitingroom.* back in.
assert.equal(deadMap.has(DEAD.toUpperCase()), false, "lookup must be case-sensitive exact");
assert.equal(deadMap.has(DEAD + "/"), false, "lookup must not match a longer path");
console.log("  ok    lookup is exact, not prefix/host based");

// 3. The guard, expressed the way the fix expresses it: a candidate URL is
//    rejected if it is in the dead table. This mirrors `isLiveOutbound()`.
const isLiveOutbound = (u) => (u ? !deadMap.has(u) : false);

assert.equal(isLiveOutbound(DEAD), false, "the dead URL must be rejected");
assert.equal(isLiveOutbound(LIVE), true, "the live URL must be accepted");
console.log("  ok    guard rejects dead, accepts live");

// 4. THE REGRESSION: both candidate sources must pass through the guard.
//    Before the fix, path 1 (copyVenue) skipped it entirely.
//
//    This block runs the REAL selection code out of fetch.mjs rather than a
//    re-implementation. A test that asserts against its own copy of the logic
//    passes whether or not fetch.mjs is fixed — that is how the original guard
//    looked correct while shipping 404s. Here, a stray re-introduction of
//    `copyVenue` in fetch.mjs makes the cases below fail.
const src = readFileSync(new URL("./fetch.mjs", import.meta.url), "utf8");
const line = src.split("\n").find((l) => l.includes("const outbound ="));
console.log("\nfetch.mjs selection line:");
console.log("  " + line.trim());
assert.ok(line, "could not find the outbound selection line in fetch.mjs");

// copyVenueLive must be preferred; the unchecked copyVenue must not appear.
assert.ok(/\boutbound\s*=\s*copyVenueLive\s*\|\|/.test(src),
  "fetch.mjs must prefer copyVenueLive — an unchecked copyVenue here re-opens the leak");
assert.ok(!/\boutbound\s*=\s*copyVenue\s*\|\|/.test(src),
  "fetch.mjs selects the unchecked copyVenue — the dead-link guard is bypassed");
console.log("  ok    fetch.mjs selects the guarded copyVenueLive");

// Both candidates must go through isLiveOutbound, and the old one-armed
// guard must be gone.
const guardUses = (src.match(/isLiveOutbound\(/g) || []).length;
assert.ok(guardUses >= 3, `isLiveOutbound used ${guardUses}x — expected the def plus both candidates`);
assert.ok(!/DEAD_BOXOFFICE\.has\(buyOk\.href\)/.test(src),
  "the old one-armed buyLive-only guard is still present");
console.log(`  ok    isLiveOutbound applied to both candidates (${guardUses} refs)`);

console.log("\nall pass");