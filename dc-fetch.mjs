// ---------------------------------------------------------------------------
// Washington, D.C. events fetcher
// ---------------------------------------------------------------------------
// Writes dc-events.json in the same schema as the San Francisco events.json, so
// the frontend needs no per-event branching — only a different feed path and a
// different set of city strings.
//
// Two deliberate differences from fetch.mjs:
//   1. Times are kept in Eastern wall-clock. A 7pm show in Washington is 7pm
//      there; converting to Pacific would put every DC listing two hours off
//      and make the whole site quietly wrong.
//   2. Popville's ACF `_datetime_from` is not trusted. It is stored as if the
//      wall-clock time were UTC, so a 7pm ET show reads 3pm. The AIOSEO schema
//      graph carries the real local time with offset; that is authoritative.
//
// Run: node dc-fetch.mjs
//

import { writeFile } from "node:fs/promises";
import * as SHARED from "./shared.mjs";
import * as HOODS from "./dc-hoods.mjs";
import { cleanTitle, cleanDescription } from "./dc-title-clean.mjs";

const TZ = "America/New_York";
const DAYS = 3; // today + 2 days, matching the SF window
const OUT = new URL("./dc-events.json", import.meta.url);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "application/json" };

// ---------------------------------------------------------------------------
// Window: today .. today+2, as Eastern dates
// ---------------------------------------------------------------------------
function windowDays() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const out = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(Date.now() + i * 86400000);
    out.push(fmt.format(d));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Eastern wall-clock from an offset-bearing ISO string
// ---------------------------------------------------------------------------
function easternParts(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  const hour = +parts.hour === 24 ? 0 : +parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + (+parts.minute || 0),
  };
}

// A date-only value (no time) is an all-day listing.
function easternDateOnly(iso) {
  const m = String(iso || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Popville
// ---------------------------------------------------------------------------
// The schema graph is the only place Popville publishes a trustworthy local
// time. Search it for the Event node rather than assuming it is first.
function schemaEvent(raw) {
  const graph = ((raw.aioseo_head_json || {}).schema || {})["@graph"];
  if (!Array.isArray(graph)) return null;
  for (const node of graph) {
    const t = node && node["@type"];
    if (t === "Event" || (Array.isArray(t) && t.includes("Event"))) return node;
  }
  return null;
}

function popvilleEvent(raw) {
  const acf = raw.acf || {};
  const city = SHARED.decodeEntities(acf._city || "");
  const state = SHARED.decodeEntities(acf._state || "");
  if (!HOODS.inDistrict(null, city, state)) return null;

  const node = schemaEvent(raw);
  const startISO = node && node.startDate;
  const endISO = node && node.endDate;

  let date, startMinutes = -1, endMinutes = -1;
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(String(startISO || ""));
  if (allDay) {
    date = easternDateOnly(startISO);
  } else {
    const s = startISO ? easternParts(startISO) : null;
    if (!s) return null;
    date = s.date;
    startMinutes = s.minutes;
    if (endISO) {
      const e = easternParts(endISO);
      if (e) endMinutes = e.minutes;
    }
  }
  if (!date) return null;

  const venue = SHARED.strip(SHARED.decodeEntities(acf._location_name || ""), 120) || null;
  // Popville carries a real _zipcode. Reading it is what turns "610 Water St
  // SW" from an unresolvable row into Southwest Waterfront, and 18 of 34 rows
  // had no ZIP at all in their address string.
  const zip = String(acf._zipcode || "").trim();
  const addressParts = [acf._address, acf._address2]
    .filter(Boolean)
    .map((s) => SHARED.decodeEntities(s))
    .map((s) => s.trim())
    .filter(Boolean);
  let address = addressParts.length ? SHARED.strip(addressParts.join(", "), 160) : null;

  // Popville often puts "Washington, DC" in _address2 and the street in
  // _address. Nothing is invented here: if there is no street, address is null
  // rather than a bare city line.
  if (address && !/\d/.test(address)) address = null;

  const embedded = (raw._embedded || {})["wp:featuredmedia"];
  const image =
    (Array.isArray(embedded) && embedded[0] && embedded[0].source_url) || null;

  const website = acf._website ? SHARED.safeUrl(acf._website) : null;

  return {
    id: `pop-${raw.id}`,
    title: cleanTitle(SHARED.decodeEntities(raw.title.rendered || "")),
    description: cleanDescription(SHARED.decodeEntities(raw.content.rendered || ""), venue),
    date,
    startMinutes,
    endMinutes,
    timeLabel: allDay ? "All day" : SHARED.timeRangeLabel(startMinutes, endMinutes),
    venue,
    address,
    zip,
    image,
    pageUrl: raw.link,
    website,
    rawCategory: null, // Popville populates no category
  };
}

async function popville() {
  const base = "https://www.popville.com/wp-json/wp/v2/events";
  let totalPages = 1;
  const first = await fetch(`${base}?per_page=100&_embed`, { headers: H });
  if (!first.ok) throw new Error(`popville HTTP ${first.status}`);
  const raw1 = await first.json();
  totalPages = Math.min(parseInt(first.headers.get("x-wp-totalpages") || "1", 10), 12);
  return { raw1, totalPages, base };
}

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------
function normalize(raw) {
  const title = raw.title;
  if (!title) return null;
  if (SHARED.CLOSED_RE.test(title)) return null;
  if (SHARED.isCancelledTitle(title)) return null;

  const url = raw.website || raw.pageUrl;
  const tier = SHARED.linkTier(url, raw.venue);

  const price = SHARED.priceFrom({
    text: raw.description,
    isFree: /\b(free|no cover|free admission|complimentary|free entry)\b/i.test(raw.description || ""),
  });

  const categories = SHARED.categorize(raw.rawCategory, title, raw.description, raw.venue);

  return {
    id: raw.id,
    title,
    description: raw.description || null,
    date: raw.date,
    startMinutes: raw.startMinutes,
    endMinutes: raw.endMinutes,
    timeLabel: raw.timeLabel,
    venue: raw.venue,
    // Prefer the ZIP: Popville supplies it even when the address line has no
    // digits at all, and it is the only key that resolves the West End, Waterfront,
    // and NoMa rows the street-name table cannot.
    neighborhood: HOODS.neighborhoodFor(raw.zip ? `${raw.address || ""} ${raw.zip}` : raw.address),
    address: raw.address,
    image: raw.image,
    url,
    linkTier: tier,
    soldOut: SHARED.soldOut({}, [title, raw.description].filter(Boolean).join(" ")),
    priceLabel: price.label,
    priceTier: price.tier,
    categories,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const days = windowDays();
  console.log(`DC Pink Pages — ${days[0]} through ${days[days.length - 1]} (${TZ})`);

  const { raw1, totalPages, base } = await popville();

  const pages = [raw1];
  let pageFails = 0;
  for (let p = 2; p <= totalPages; p++) {
    try {
      const r = await fetch(`${base}?per_page=100&_embed&page=${p}`, { headers: H });
      if (!r.ok) { pageFails++; break; }
      pages.push(await r.json());
    } catch (e) {
      // Stopping early is correct; doing so silently is not. A truncated
      // page walk publishes a short feed that reads exactly like a quiet week.
      pageFails++;
      console.log(`  popville: page ${p} of ${totalPages} failed (${e.message}) — feed is PARTIAL`);
      break;
    }
  }
  const all = pages.flat();
  console.log(`  popville: ${all.length} records across ${pages.length}/${totalPages} pages${pageFails ? ` (${pageFails} page failure(s))` : ""}`);

  // Parse -> normalize -> filter -> dedupe.
  const events = [];
  let outsideDC = 0;
  let cancelled = 0;
  let noTime = 0;

  for (const raw of all) {
    const parsed = popvilleEvent(raw);
    if (!parsed) {
      const acf = raw.acf || {};
      if (
        !HOODS.inDistrict(
          null,
          SHARED.decodeEntities(acf._city || ""),
          SHARED.decodeEntities(acf._state || "")
        )
      )
        outsideDC++;
      else noTime++;
      continue;
    }
    if (!days.includes(parsed.date)) continue;
    const n = normalize(parsed);
    if (!n) {
      if (SHARED.isCancelledTitle(parsed.title)) cancelled++;
      continue;
    }
    events.push(n);
  }

  // Dedupe on date + normalized title, then on page URL, then on a venue FOLD.
    //
    // The venue fold is not cosmetic. Popville carries the branch as part of the
    // venue name — "Politics and Prose: The Wharf" and "Politics and Prose" are
    // the same bookseller, and on a busy night both appear, which printed the
    // same author talk twice. Folding on ": " is right for the venues that
    // suffix a branch that way and harmless elsewhere, because the dedupe still
    // requires the same date, time and title.
    const seenKey = new Set();
    const seenUrl = new Set();
    const seenVenueFold = new Set();
    const deduped = [];
    let dupes = 0;
    for (const e of events) {
      const key = `${e.date}|${e.startMinutes}|${e.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${(e.venue || "").toLowerCase()}`;
      const foldKey = `${e.date}|${e.startMinutes}|${e.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${(e.venue || "")
        .split(":")[0]
        .trim()
        .toLowerCase()}`;
      const u = SHARED.safeUrl(e.url);
      const urlKey = `${e.date}|${u ? u.hostname + u.pathname : e.url}`;
      if (seenKey.has(key) || seenUrl.has(urlKey) || seenVenueFold.has(foldKey)) {
        dupes++;
        continue;
      }
      seenKey.add(key);
      seenUrl.add(urlKey);
      seenVenueFold.add(foldKey);
      deduped.push(e);
    }

  deduped.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startMinutes - b.startMinutes ||
      (a.venue || "").localeCompare(b.venue || "")
  );

  const hoods = HOODS.hoodsOf(deduped);
  const unresolved = hoods.find((h) => h.hood === "Washington");
  console.log(`  kept ${deduped.length}; ${dupes} duplicates collapsed`);
  console.log(`  outside DC: ${outsideDC}   cancelled titles: ${cancelled}   unusable times: ${noTime}`);
  console.log(
    `  neighborhoods: ${hoods.length} (${deduped.length - (unresolved ? unresolved.n : 0)}/${
      deduped.length
    } resolved)`
  );
  console.log(`  images: ${deduped.filter((e) => e.image).length}`);
  console.log(`  priced: ${deduped.filter((e) => e.priceLabel).length}`);
  console.log(`  venue links: ${deduped.filter((e) => e.linkTier === "venue").length}`);

  const payload = {
    generatedAt: new Date().toISOString(),
    city: "Washington",
    tz: TZ,
    days,
    counts: {
      total: deduped.length,
      free: deduped.filter((e) => e.priceTier === "free").length,
      directLinks: deduped.filter((e) => e.linkTier === "venue").length,
      boxOfficeLinks: deduped.filter((e) => e.linkTier === "boxoffice").length,
      aggregatorLinks: deduped.filter((e) => e.linkTier === "listing").length,
    },
    neighborhoods: hoods.map((h) => ({ name: h.hood, count: h.n })),
    events: deduped,
  };

  await writeFile(OUT, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${deduped.length} events to dc-events.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
