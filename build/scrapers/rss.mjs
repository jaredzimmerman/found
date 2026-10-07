// RSS scraper strategy.
//
// An RSS/Atom feed is XML with <item>/<entry> elements. The strategy
// is: parse the XML with regexes (no xml2js on DreamHost), extract
// the standard RSS fields (title, link, description, pubDate), and
// let the per-site template map custom namespaces and fields.
//
// Per-site templates decide which fields map and how to clean them.
// This module only knows how to find and parse RSS items.

const decodeEntities = (s) => {
  if (!s) return "";
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
};

const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// Extract <item> blocks from RSS XML. No xml2js on DreamHost, so
// regex-based parsing is the only option.
export function extractRssItems(xml) {
  const items = [];
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const body = m[1];
    const field = (tag) => {
      const fRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
      const fm = body.match(fRe);
      return fm ? decodeEntities(stripTags(fm[1])).trim() : null;
    };
    const cdataField = (tag) => {
      const fRe = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i");
      const fm = body.match(fRe);
      return fm ? decodeEntities(stripTags(fm[1])).trim() : null;
    };
    items.push({
      title: field("title"),
      link: field("link"),
      description: cdataField("description") || field("description"),
      pubDate: field("pubDate"),
      guid: field("guid"),
      body, // raw body for custom namespace extraction
    });
  }
  return items;
}

// Extract a custom namespaced field from an RSS item body.
// e.g. extractCustom(item.body, "location") finds <location>...</location>
export function extractCustom(body, tag) {
  if (!body) return null;
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = body.match(re);
  return m ? decodeEntities(stripTags(m[1])).trim() : null;
}

// Map an RSS item to our event shape using a template.
export function applyTemplate(item, template) {
  const map = template.fields || {};
  const out = {};
  for (const [outField, spec] of Object.entries(map)) {
    if (typeof spec === "string") {
      // dotted-path on the item, or a custom tag name
      if (item[spec] != null) {
        out[outField] = item[spec];
      } else {
        out[outField] = extractCustom(item.body, spec);
      }
    } else if (typeof spec === "function") {
      out[outField] = spec(item);
    }
  }
  return out;
}
