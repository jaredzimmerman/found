// Per-site templates.
//
// Each template maps a site's data structure onto our event shape.
// A template is complete when it maps ALL required fields:
//   title, venue, address, description, image, priceLabel, categories
//
// If a template is missing a field, that field will be null —
// never fabricated. Missing fields are honest gaps in the source.
//
// Field spec types:
//   "dotted.path"  — look up a nested field
//   (item) => val  — custom extractor function

// --- Luma (JSON-LD) ---
// Listing page has JSON-LD with images but no descriptions;
// individual event pages have full JSON-LD with descriptions.
export const lumaTemplate = {
  type: "jsonld",
  url: "https://luma.com/sf",
  fields: {
    title: (ev) => ev.name || null,
    url: (ev) => ev.url || null,
    description: (ev) => ev.description || null,
    image: (ev) => (Array.isArray(ev.image) ? ev.image[0] : ev.image) || null,
    venue: (ev) => (ev.location && ev.location.name) || null,
    address: (ev) => {
      const la = (ev.location && ev.location.address) || {};
      if (typeof la === "string") return la;
      const street = la.streetAddress || la.street || null;
      const locality = la.addressLocality || null;
      if (street && locality) return `${street}, ${locality}`;
      return street || null;
    },
    startDate: (ev) => (ev.startDate && ev.startDate["@value"]) || ev.startDate || null,
    endDate: (ev) => (ev.endDate && ev.endDate["@value"]) || ev.endDate || null,
  },
  filter: (ev) => {
    // SF only — exclude Berkeley, Oakland, etc.
    const la = (ev.location && ev.location.address) || {};
    const locality = typeof la === "string" ? la : (la.addressLocality || "");
    return String(locality).trim() === "San Francisco";
  },
};

// --- Decentered (RSS) ---
// RSS feed with <title>, <link>, <description>, and custom
// <location>, <address>, <hours> fields in each <item>.
export const decenteredTemplate = {
  type: "rss",
  url: "https://events.decentered.org/feeds/rss.xml",
  fields: {
    title: "title",
    url: "link",
    description: "description",
    venue: (item) => extractCustom(item.body, "address"),
    address: (item) => extractCustom(item.body, "address"),
    date: (item) => extractCustom(item.body, "hours"),
  },
  filter: (item) => {
    // SF only
    const loc = extractCustom(item.body, "location") || "";
    const cleaned = loc.replace(/<br\s*\/?>/gi, "").trim();
    return /^san francisco$/i.test(cleaned);
  },
};

// --- Workshop SF (API) ---
// WordPress REST API returning event JSON.
export const workshopSfTemplate = {
  type: "api",
  url: "https://workshopsf.org/wp-json/tribe/events/v1/events?per_page=50",
  template: {
    path: "events",
  },
  fields: {
    title: "title",
    url: "url",
    description: "description",
    image: (ev) => (ev.image && ev.image.url) || null,
    venue: "venue.venue",
    address: "venue.address",
    startDate: "start_date",
    endDate: "end_date",
    categories: (ev) => (ev.categories || []).map((c) => c.name),
  },
};

// --- ESPN WNBA (API) ---
// ESPN API for Golden State Valkyries schedule.
export const valkyriesTemplate = {
  type: "api",
  url: "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/129689/schedule",
  template: {
    path: "events",
  },
  fields: {
    title: "name",
    url: "links.0.href",
    venue: "competitions.0.venue.fullName",
    address: (ev) => {
      const v = (ev.competitions && ev.competitions[0] && ev.competitions[0].venue) || {};
      return v.address || null;
    },
    startDate: "date",
    categories: () => ["WNBA"],
  },
};
