// DOM scraper strategy.
//
// An HTML page with no JSON-LD and no RSS — the events are in
// the DOM. The strategy is: fetch the HTML, use regex-based
// extraction on the DOM structure, and let the per-site template
// define the selectors and patterns.
//
// Per-site templates decide which patterns to match and how to
// clean the results. This module only knows how to fetch HTML.

import { getText } from "../http.mjs";

export async function fetchHtml(url, options = {}) {
  const headers = {
    "User-Agent": options.userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
  };
  return getText(url, { headers, timeoutMs: options.timeout || 30000 });
}

// Extract all matches of a pattern from HTML.
// Pattern is a regex with capture groups named in the template.
export function extractByPattern(html, pattern) {
  const results = [];
  const re = new RegExp(pattern, "gi");
  let m;
  while ((m = re.exec(html)) !== null) {
    results.push(m);
  }
  return results;
}

// Extract repeated blocks from HTML.
// blockPattern matches one event block; fieldPatterns extract fields within it.
export function extractBlocks(html, blockPattern, fieldPatterns) {
  const results = [];
  const blockRe = new RegExp(blockPattern, "gi");
  let bm;
  while ((bm = blockRe.exec(html)) !== null) {
    const block = bm[0];
    const fields = {};
    for (const [name, fp] of Object.entries(fieldPatterns)) {
      const fre = new RegExp(fp, "i");
      const fm = block.match(fre);
      fields[name] = fm ? fm[1].trim() : null;
    }
    results.push(fields);
  }
  return results;
}
