// API scraper strategy.
//
// A JSON API endpoint that returns events directly. The strategy
// is: fetch the JSON, find the array of events (at a known path
// or by scanning for arrays of objects with title/date fields),
// and let the per-site template map the fields.
//
// Per-site templates decide which path to read and how to map.
// This module only knows how to fetch and locate the event array.

export async function fetchJson(url, options = {}) {
  const headers = {
    "User-Agent": options.userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json",
  };
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(options.timeout || 30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Find the array of events in a JSON response.
// Tries the given path first, then scans for arrays of objects
// that look like events (have a title or name field).
export function findEventArray(data, path) {
  if (path) {
    const val = path.split(".").reduce((o, k) => (o && o[k] != null ? o[k] : null), data);
    if (Array.isArray(val)) return val;
  }
  // Scan for arrays of objects with title/name fields
  const scan = (node) => {
    if (Array.isArray(node)) {
      if (node.length && node.every((x) => x && typeof x === "object" && (x.title || x.name))) {
        return node;
      }
      for (const item of node) {
        const found = scan(item);
        if (found) return found;
      }
    } else if (node && typeof node === "object") {
      for (const val of Object.values(node)) {
        const found = scan(val);
        if (found) return found;
      }
    }
    return null;
  };
  return scan(data) || [];
}

// Map an API event to our event shape using a template.
export function applyTemplate(item, template) {
  const map = template.fields || {};
  const out = {};
  for (const [outField, spec] of Object.entries(map)) {
    if (typeof spec === "string") {
      const val = spec.split(".").reduce((o, k) => (o && o[k] != null ? o[k] : null), item);
      out[outField] = val != null ? String(val) : null;
    } else if (typeof spec === "function") {
      out[outField] = spec(item);
    }
  }
  return out;
}
