// Template registry.
//
// Maps a site identifier to a scraping configuration:
//   - type: "jsonld" | "rss" | "dom" | "api"
//   - url: the endpoint or page to fetch
//   - template: the per-site field mapping
//   - filters: functions to apply to each extracted event
//
// A new source is added by:
//   1. Identifying the page type (JSON-LD, RSS, DOM, API)
//   2. Writing a template that maps all needed fields
//   3. Registering it here
//
// The registry is the single place that knows what sources exist.
// fetch.mjs reads this and dispatches to the right strategy.

import { findEvents, flattenAddress, applyTemplate as applyJsonLd } from "./jsonld.mjs";
import { extractRssItems, extractCustom, applyTemplate as applyRss } from "./rss.mjs";
import { fetchHtml } from "./dom.mjs";
import { fetchJson, findEventArray, applyTemplate as applyApi } from "./api.mjs";

const registry = [];

// Register a source. opts:
//   id: unique identifier
//   type: "jsonld" | "rss" | "dom" | "api"
//   url: string or () => string
//   template: { fields: { outField: "path" | (item) => value } }
//   filter: (item) => bool  — skip events that fail
//   normalize: (item) => item  — post-template normalization
export function registerSource(opts) {
  registry.push(opts);
}

export function getSources() {
  return registry;
}

// Dispatch to the right strategy based on type.
export async function scrapeSource(source) {
  const url = typeof source.url === "function" ? source.url() : source.url;
  let items = [];

  switch (source.type) {
    case "jsonld": {
      const html = await fetchHtml(url, source.options);
      const blocks = [];
      const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        try {
          const data = JSON.parse(m[1]);
          const arr = Array.isArray(data) ? data : [data];
          blocks.push(...arr);
        } catch { /* skip malformed */ }
      }
      for (const block of blocks) {
        for (const ev of findEvents(block)) {
          items.push(ev);
        }
      }
      break;
    }
    case "rss": {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const xml = await r.text();
      items = extractRssItems(xml);
      break;
    }
    case "dom": {
      const html = await fetchHtml(url, source.options);
      // DOM sources use a custom extractor from the template
      if (source.template.extract) {
        items = source.template.extract(html);
      }
      break;
    }
    case "api": {
      const data = await fetchJson(url, source.options);
      items = findEventArray(data, source.template.path);
      break;
    }
  }

  // Apply template to map fields
  let events = items.map((item) => {
    const apply = { jsonld: applyJsonLd, rss: applyRss, dom: applyRss, api: applyApi }[source.type];
    return apply(item, source.template);
  });

  // Apply filter
  if (source.filter) {
    events = events.filter(source.filter);
  }

  // Apply normalization
  if (source.normalize) {
    events = events.map(source.normalize);
  }

  return events;
}

export { flattenAddress, extractCustom };
