// ---------------------------------------------------------------------------
// SF Station — Transbay Terminal's own calendar.
//
// Measured 2026-10-03. Every listing is schema.org Event microdata inside
// `div.event-wrapper`, so the whole calendar is in the served HTML with no
// JavaScript executed. That matters beyond tidiness: the DreamHost build cannot
// run a browser at all (the shared grsec kernel blocks Chrome's zygote fork), so
// a source that only resolves after JS runs would be permanently unavailable
// there. This one does not.
//
// Two traps, both of which produce a plausible-looking wrong answer:
//
//   1. `itemprop="name"` appears TWICE per block — once on the event, once on
//      the inner venue. Taking the last match returns the venue name for every
//      row, so the calendar fills with 30 listings all called "SF Station".
//      The event's own name is the one inside the <h1>-class heading, which is
//      always the FIRST match in document order.
//
//   2. The hidden `event-time` div is "11am - 4pm: African Arts Festival" —
//      the time span followed by the title. Splitting on ":" is what separates
//      them; taking the whole string yields "11am - 4pm: African Arts Festival"
//      as a time label.
//
// Prices: this calendar prints "FREE" or nothing at all. A row with no FREE gets
// no price tag (tier "unknown") rather than a guessed amount — the card links
// to the venue, which is where the real price lives. Rounding to whole dollars
// happens once, in main(), over the whole corpus, so this module does not round
// and cannot disagree with the other sources.
// ---------------------------------------------------------------------------

// Imported from fetch.mjs, which is circular by design and one-directional in
// practice: every one of these is a hoisted function declaration or a `const`
// that is initialised before main() runs, so the module graph resolves. This is
// the same arrangement manual-venues.mjs uses; a second copy of `cleanTitle` or
// `register` would be a second dedupe key, and two would drift.
import { tSafe, decodeEntities, cleanTitle, register } from "./fetch.mjs";

const CAL = "https://www.sfstation.com/calendar";

// One listing block. `event-wrapper` is the tight boundary: the inner row
// classes (`row-auth ev`) also appear in page chrome, so a looser selector
// yields duplicates.
const BLOCK_SPLIT = /(?=<div class="event-wrapper")/;

// Transbay Terminal's published address, used when a row omits its venue block
// so hoodsOf() still has a real street to work from.
const VENUE = "SF Station";
const VENUE_ADDRESS = "425 Mission St, San Francisco, CA 94105";

// Reads a microdata `content=` attribute, tolerating both attribute order AND
// either element type.
//
// The element type matters: SF Station publishes startDate/endDate on a
// `<div class="event-date hidden" itemprop="startDate" content="2026-10-03">`
// with the value ALSO as its text, while image/address come as `<meta>`. A
// `<meta`-only reader silently returns null for every date, which drops the
// entire source with no error — 0 events, no warning, indistinguishable from
// "nothing on this calendar". So this matches any element that carries both
// the itemprop and a content attribute.
function meta(block, itemprop) {
  const re = new RegExp(
    `<[a-z]+[^>]*itemprop="${itemprop}"[^>]*content="([^"]*)"`, "i"
  );
  const m = block.match(re);
  if (m) return decodeEntities(m[1]);
  const alt = block.match(new RegExp(
    `<[a-z]+[^>]*content="([^"]*)"[^>]*itemprop="${itemprop}"`, "i"
  ));
  return alt ? decodeEntities(alt[1]) : null;
}

// Artwork. Two things this source does differently from the microdata pattern:
//
//   1. The image is `itemprop="image" src="…"` on an <img>, not a content=
//      attribute — a content-only reader finds no artwork on every row.
//   2. The published src is a small CDN thumbnail. Shipping that would put a
//      stretched image in the card's halftone tile, which is sized well above
//      it. The original is embedded in the thumbnail path as a
//      `/<mode>/<url-encoded original>` tail — the mode is `top` on some rows
//      and `center` on others, so matching one literal silently leaves the other
//      set on thumbnails. Match the mode positionally instead.
//      When the tail is absent the src is used as-is — a correct small image
//      beats a broken large one.
function artwork(block) {
  const m = block.match(/itemprop="image"[^>]*src="([^"]+)"/i);
  if (!m) return null;
  const src = decodeEntities(m[1]);
  const tail = src.match(/\/(?:top|center|middle|bottom)\/(https?%3A%2F%2F[^"?]+)/i);
  if (!tail) return src;
  try {
    return decodeURIComponent(tail[1]);
  } catch {
    return src;
  }
}

// The FIRST itemprop="name" in the block. See trap 1 above.
function eventName(block) {
  const m = block.match(/itemprop="name"[^>]*>([\s\S]*?)</i);
  if (!m) return null;
  return decodeEntities(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function text(block, cls) {
  const m = block.match(new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)</`, "i"));
  if (!m) return null;
  return decodeEntities(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function timeOfDay(block) {
  // See trap 2: take only what precedes the ":" OR " / ".
  // The hidden event-time div is like "11am - 4pm: African Arts Festival" (colon split)
  // or "7:30pm / A a duo concert..." (slash split).
  const raw = text(block, "event-time") || "";
  // Isolate the time specification before any descriptive text.
  let timeStr = raw;
  const slashIdx = timeStr.indexOf(" / ");
  if (slashIdx !== -1) {
    timeStr = timeStr.slice(0, slashIdx);
  } else {
    const colonIdx = timeStr.indexOf(": ");
    if (colonIdx !== -1) {
      timeStr = timeStr.slice(0, colonIdx);
    }
  }
  // NOTE: do NOT split on ":" here — "7:30pm" would become "7" and lose the meridiem.
  const span = timeStr.trim();
  const times = [...span.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/gi)];
  if (!times.length) return { startMinutes: -1, endMinutes: -1, label: null };
  const toMin = (t) => {
    let h = parseInt(t[1], 10) % 12;
    const m = t[2] ? parseInt(t[2], 10) : 0;
    if (/pm/i.test(t[3])) h += 12;
    return h * 60 + m;
  };
  const fmt = (mins) => {
    if (mins < 0) return null;
    const h24 = Math.floor(mins / 60), mm = mins % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(mm).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
  };
  const start = toMin(times[0]);
  const end = times[1] ? toMin(times[1]) : -1;
  return { startMinutes: start, endMinutes: end, label: end >= 0 ? `${fmt(start)}–${fmt(end)}` : fmt(start) };
}

async function sfStation(days) {
  const html = await tSafe(CAL);
  if (!html) return console.log("  sfstation: page unavailable — skipped");

  const blocks = html.split(BLOCK_SPLIT).slice(1);
  if (!blocks.length) return console.log("  sfstation: 0 listing blocks — the page changed shape");

  let added = 0;
  let inWindow = 0;
  let unnamed = 0;

  for (const b of blocks) {
    const iso = meta(b, "startDate");
    if (!iso || !days.includes(iso)) continue;
    inWindow++;

    const rawTitle = eventName(b);
    if (!rawTitle) { unnamed++; continue; }
    const title = cleanTitle(rawTitle);
    if (!title) { unnamed++; continue; }

    const t = timeOfDay(b);
    const href = (b.match(/<a href="(\/[^"]+)"[^>]*>\s*<img/) || [])[1];
    const free = /\bFREE\b/.test(b.replace(/<[^>]+>/g, " "));
    const timeKey = t.startMinutes < 0 ? "tba" : String(t.startMinutes);

    const row = {
      source: "SF Station",
      id: `sfstation-${iso}-${slug(title)}-${timeKey}`,
      title,
      venue: VENUE,
      neighborhood: "San Francisco",
      address: VENUE_ADDRESS,
      description: "",
      image: artwork(b),
      date: iso,
      startMinutes: t.startMinutes,
      endMinutes: t.endMinutes,
      timeLabel: t.label || "Time TBA",
      priceLabel: free ? "Free" : null,
      priceTier: free ? "free" : "unknown",
      // SF Station is one building, so these belong to the venue's own
      // calendar rather than a citywide taxonomy. Left empty rather than
      // guessed — an empty list renders no category chips instead of a wrong
      // one, and the hood pass below still resolves the neighborhood.
      categories: [],
      url: href ? `https://www.sfstation.com${href}` : CAL,
      linkTier: "venue",
      soldOut: false,
    };
    if (register(row)) added++;
  }

  console.log(`  sfstation: ${added} in-window events (${inWindow} dated in window, ${unnamed} skipped for no title, ${blocks.length} blocks)`);
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 28);
}

export { sfStation };