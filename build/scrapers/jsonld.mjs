// JSON-LD scraper strategy.
//
// A page with JSON-LD structured data (schema.org Event, etc.) carries
// the fields we need in a machine-readable block. The strategy is:
// find every <script type="application/ld+json"> block, parse it,
// and map the schema.org fields onto the event shape.
//
// Per-site templates decide WHICH fields map and HOW to clean them.
// This module only knows how to find and parse JSON-LD.

const decodeEntities = (s) => {
  if (!s) return "";
  const map = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
  return String(s).replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => map[m] || m);
};

const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// Extract all JSON-LD blocks from an HTML page.
export function extractJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      // JSON-LD can be a single object or an array of objects
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item && typeof item === "object") blocks.push(item);
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return blocks;
}

// Find the Event objects in a JSON-LD tree, following @graph if present.
export function findEvents(jsonld) {
  const events = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const type = node["@type"];
    if (type === "Event" || (Array.isArray(type) && type.includes("Event"))) {
      events.push(node);
    }
    // schema.org often nests events under @graph or a containing page
    if (node["@graph"]) node["@graph"].forEach(visit);
    if (node.event) visit(node.event);
    if (node.subEvent) visit(node.subEvent);
  };
  visit(jsonld);
  return events;
}

// Flatten a schema.org PostalAddress object to "Street, Locality".
export function flattenAddress(addr) {
  if (!addr) return null;
  if (typeof addr === "string") return decodeEntities(stripTags(addr));
  const street = addr.streetAddress || addr.street || null;
  const locality = addr.addressLocality || null;
  if (street && locality) return `${decodeEntities(stripTags(street))}, ${decodeEntities(stripTags(locality))}`;
  if (street) return decodeEntities(stripTags(street));
  return null;
}

// Map a schema.org Event to our event shape using a template.
// The template provides field mappings and cleaners.
export function applyTemplate(ev, template) {
  const map = template.fields || {};
  const out = {};
  for (const [outField, spec] of Object.entries(map)) {
    if (typeof spec === "string") {
      // simple dotted-path lookup
      const val = spec.split(".").reduce((o, k) => (o && o[k] != null ? o[k] : null), ev);
      out[outField] = val != null ? decodeEntities(stripTags(String(val))) : null;
    } else if (typeof spec === "function") {
      out[outField] = spec(ev);
    }
  }
  return out;
}
