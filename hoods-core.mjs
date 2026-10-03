// ---------------------------------------------------------------------------
// hoods-core.mjs — the city-agnostic half of neighborhood resolution
// ---------------------------------------------------------------------------
// Both cities run the same three-step algorithm:
//
//   1. ZIP is the most reliable single key. Look it up in this city's table.
//   2. No ZIP: a cross street usually names the neighborhood. Match this city's
//      street patterns.
//   3. Honest fallback. If the row already carries something more specific than
//      the city, keep it — that is how Mission and North Beach survived the
//      original SF pass, and how a hand-set neighborhood survives any pass.
//      Otherwise the city itself, because "undecided" is a better answer than a
//      guess.
//
// hoods.mjs and dc-hoods.mjs now hold only the tables and a call. The
// duplication was 96 of 100 lines, and the two copies had already drifted once:
// DC's `hoodsOf` recomputes `neighborhoodFor` for every event, which is fine,
// but the SF copy's fallback test was a literal `/^san francisco$/i` while the
// DC copy's tested both spellings — so the two disagreed on what "the city"
// means, which is the one thing this file exists to define.

// Build the two lookup functions for one city from its tables.
export function neighborhoodEngine({ byZip, streetHood, cityName, cityAliases = [] }) {
  const cityTest = cityAliases.length
    ? new RegExp(`^(?:${cityAliases.join("|")})$`, "i")
    : new RegExp(`^${cityName}$`, "i");

  /** Best-effort neighborhood for one event. */
  function neighborhoodFor(address, fallback) {
    const a = String(address || "").trim();
    if (a) {
      const z = a.match(/\b(\d{5})\b/);
      if (z && byZip.has(Number(z[1]))) return byZip.get(Number(z[1]));

      for (const [re, hood] of streetHood) {
        if (re.test(a)) return hood;
      }
    }
    const f = String(fallback || "").trim();
    if (f && !cityTest.test(f)) return f;
    return cityName;
  }

  /** The distinct neighborhoods present in a set of events, most common first. */
  function hoodsOf(events) {
    const c = new Map();
    for (const e of events) {
      const h = neighborhoodFor(e.address, e.neighborhood);
      e.neighborhood = h; // so the page's own grouping agrees with the filter
      c.set(h, (c.get(h) || 0) + 1);
    }
    return [...c.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([h, n]) => ({ hood: h, n }));
  }

  return { neighborhoodFor, hoodsOf };
}
