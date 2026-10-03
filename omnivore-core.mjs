// Omnivore Books — 3885a Cesar Chavez St, Dogpatch.
//
// THE SHAPE OF THIS SOURCE, established by probing the live site rather than
// assumed. Every one of these was checked, and the reasons the wrong answers
// were rejected are recorded so the next pass does not re-derive them:
//
//   1. products.json  200, keyless, 23 products. TITLES and PRICES are here.
//   2. `published_at` is NOT the event date. It spans 2026-03-11..2026-09-27 on a
//      collection named "upcoming events" — a CMS publish date. Using it would
//      put every event on the day the shopkeeper created the listing.
//   3. The collection page renders NO date: zero month/day strings, zero `alt`
//      text, zero JSON-LD, zero `datetime=`, zero metafields. The grid is
//      client-rendered, so even the product links are absent from static HTML.
//   4. The date is printed on the poster PNG — as PIXELS. A vision model reads
//      "Tuesday / 6 / October / 6:30 pm" correctly; a scraper cannot.
//   5. The PRODUCT PAGE carries it as TEXT:
//        <div class="product-form--block--overline">Tuesday, October 6 at 6:30 pm
//      with `text-transform: uppercase` in CSS. The DOM text is title-case; only
//      the rendered pixels are uppercase, so a case-sensitive pattern against
//      innerText breaks while one against the DOM holds.
//   6. The address is NOT in the DOM — only on the poster. It is hand-kept below
//      and every claim about it was read off the live poster image.
//
// So: the feed gives the roster and the price; the product page gives the date
// and time. That split is why this is O(products) page fetches, not one.

export const OMNIVORE_VENUE = "Omnivore Books on Food";
export const OMNIVORE_ADDRESS = "3885a Cesar Chavez St, San Francisco, CA 94124";
export const OMNIVORE_URL = "https://omnivorebooks.myshopify.com";

const MONTH_IDX = Object.fromEntries(
  ["january", "february", "march", "april", "may", "june", "july",
   "august", "september", "october", "november", "december"]
    .map((m, i) => [m, i])
);

// The overline is the ONLY element on the page carrying a month and a day.
// Verified across an OFF-SITE template, a long title and a short one — all three
// resolve to the same class, so it is a stable selector and not a coincidence of
// one template. Pinned because a selector that happens to work on the first page
// is not a contract.
const OMNIVORE_DATE_EL = /product-form--block--overline/i;

// "Tuesday, October 6 at 6:30 pm" — title-case in the DOM, uppercase only in CSS.
// The year is not printed. December/January listings therefore need the window's
// year, and a December listing seen in January belongs to the PREVIOUS year —
// handled by `omnivoreYear`, which resolves against the window rather than
// assuming the current calendar year.
export function omnivoreSchedule(overline, windowDays) {
  const m = String(overline || "").match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b(?:[^0-9]{0,12}?(\d{1,2}:\d{2})\s*(am|pm))?/i
  );
  if (!m) return null;
  const mi = MONTH_IDX[m[1].toLowerCase()];
  if (mi == null) return null;
  const day = Number(m[2]);
  if (!day || day > 31) return null;

  const clock = m[3] && m[4] ? `${m[3]}${m[4].toLowerCase()}` : "";
  // Year resolution: pick the window year whose Oct/Nov/Dec slot holds this
  // date. Scanning the window rather than reading `new Date()` is what makes a
  // December event correct when the window is in January.
  let iso = null;
  for (const d of windowDays || []) {
    const cand = `${d.slice(0, 4)}-${String(mi + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if ((windowDays || []).includes(cand)) { iso = cand; break; }
  }
  // No day in the window matches this month/day, so there is no honest date to
  // publish. Returning the partial object here would hand the caller a row with
  // `iso: null` that reads like a parsed schedule — the exact shape of bug this
  // project has shipped before, where a null date slipped into the feed.
  if (!iso) return null;
  return { iso, clock };
}

// The roster. `price` is a string on the variant, and every listing is 0.00 —
// so price is a real field that happens to be uniformly free, NOT a missing one.
// Treating "0.00" as "no price data" would be correct by accident here and wrong
// the day a paid event is added.
export function omnivoreRows(products) {
  const out = [];
  for (const p of products || []) {
    const title = String(p.title || "")
      .replace(/\s*•\s*/g, " — ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!title) continue;
    // "*OFF-SITE*" is the store's own marker: the event happens elsewhere. It is
    // real information about the listing and stays in the title, but the venue
    // and address must NOT be Omnivore's, because the reader would be sent to the
    // wrong building. linkTier reflects that it is the organiser's page.
    const offSite = /^\*OFF-SITE\*/i.test(String(p.title || ""));
    const v = (p.variants || [])[0] || {};
    const price = v.price == null ? null : Number(v.price);
    out.push({
      id: `omni-${p.id}`,
      title,
      handle: p.handle,
      publishedAt: p.published_at || "",
      // null = genuinely unknown. Never substituted with the publish date.
      overline: null,
      price: Number.isFinite(price) ? price : null,
      priceTier: price === 0 ? "free" : price > 0 ? "paid" : "unknown",
      available: v.available !== false,
      offSite,
      image: (p.images || [])[0]?.src || null,
      description: String(p.body_html || ""),
    });
  }
  return out;
}

// The date element, pulled from one product page's static/dom HTML.
export function omnivoreOverline(html) {
  if (!html) return null;
  // Cut at the closing tag of the SAME element the class was found on, then
  // strip the remaining INLINE tags. Two earlier versions failed and both
  // failures looked like a source that had stopped publishing dates:
  //   · a non-greedy `([\s\S]{0,120}?)<\/` stopped at the INNER `</span>` of
  //     "Tuesday, <span>October 6</span> at 6:30 pm" and silently lost the time;
  //   · cutting at the first block-ish tag left a literal "</div" in the value.
  // Matching the opening tag's own name and stripping only inline tags after it
  // is what survives nesting. Inline-only on purpose: a nested BLOCK element is
  // the start of the next field, not part of the date.
  const open = html.match(
    /<(\w+)[^>]*class="[^"]*product-form--block--overline[^"]*"[^>]*>/i
  );
  if (!open) return null;
  const tag = open[1];
  const tail = html.slice(open.index + open[0].length, open.index + open[0].length + 300);
  const close = tail.search(new RegExp(`</${tag}\\b`, "i"));
  const chunk = close === -1 ? tail : tail.slice(0, close);
  return chunk
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}
