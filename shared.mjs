// ---------------------------------------------------------------------------
// shared.mjs — the parts of the pipeline that are NOT San Francisco.
//
// Everything in here is city-agnostic: how a title and a description are
// cleaned, how a price is read, how a category is decided, how a clock time is
// shaped into a label, and how a scraped link is judged venue / box office /
// listing. The San Francisco fetcher and the Washington, D.C. fetcher both
// import these rather than keeping their own copies.
//
// Why this file exists: the categorizer, the entity decoder and the link-tier
// rules were all originally private to fetch.mjs. Adding a second city meant
// either importing fetch.mjs (which RUNS the whole San Francisco scrape on
// import, because main() is called at module scope — so the DC build would have
// silently published a second SF feed) or copying ~400 lines, which is how two
// implementations of cleanDescription and cleanTitle drifted apart once already
// and left the tests green against the copy that did not ship.
//
// So: one definition, imported by both cities, exercised by the same tests.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Emoji
// ---------------------------------------------------------------------------
// The sources put emoji in their prose and we do not print them. Not a
// preference: the paper's whole voice is newsprint, and a row that opens with a
// pin and a calendar reads as a different site pasted into this one.
//
// This covers the pictographic blocks and the two variation selectors that ride
// along with them (U+FE0F in particular, which is invisible on its own — strip
// the base glyph and leave U+FE0F and you get a stray zero-width character in
// the middle of a word).
//
// Regional indicator pairs (flag emoji, U+1F1E6–U+1F1FF) are inside the
// 1F000–1FAFF range above, so they go too.
//
// U+200D ZWJ and U+20E3 COMBINING ENCLOSING KEYCAP are the joiners that hold
// multi-glyph emoji sequences together (👨‍👩‍👧‍👦 is four people and three
// joiners). Removing only the people leaves the joiners behind as invisible
// characters mid-sentence, so they go as well. No listing in either feed uses a
// joiner for anything else, which was checked before removing them rather than
// assumed.
//
// ARROWS ARE NOT STRIPPED. U+2190–U+21FF is excluded on purpose: "→" is a
// pictographic block, but in prose it carries meaning — "U Street → Dupont" is a
// route, and eating the arrow turns a route into two place names. Emoji here
// means decorative, and an arrow in a venue description is not decoration.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2B50}\u{3030}\u{303D}\u{203C}\u{2049}\u{2122}\u{2139}\u{24C2}\u{FE0F}\u{20E3}\u{200D}]/gu;

const STAR = "★";

/** Remove emoji, keeping ★ (a film rating / artist name, not decoration). */
export const deemoji = (s) => {
  const src = String(s == null ? "" : s);
  // ★ shares the 2600–27BF block with a fire and a party popper but is
  // CONTENT, so it is pulled out around the filter rather than special-cased
  // inside it. Split on it, clean each side, rejoin with the star intact.
  //
  // The segments are NOT trimmed individually: each one is a fragment of one
  // string, so trimming "…(R) " to "…(R)" deleted the space before the star and
  // printed "(R)★". Only the rejoined result is trimmed, once, at the end.
  if (!src.includes(STAR)) return tidyEmoji(src.replace(EMOJI, ""));
  return tidyEmoji(
    src.split(STAR).map((part) => part.replace(EMOJI, "")).join(STAR)
  );
};

// Tidy what removing an emoji leaves behind. Kept separate from the filter so
// it runs per-segment when the star has been split out; chaining it over the
// joined string instead would collapse the spaces the star is holding apart.
const tidyEmoji = (s) =>
  s
    // An emoji between two words leaves a double space; several in a row leave a
    // run of them. One pass collapses what is left.
    .replace(/[ \t]{2,}/g, " ")
    // An emoji at the end of a clause leaves the punctuation orphaned with a
    // space in front of it: "believes ." reads as a typo rather than as a
    // removal. Close the gap before sentence punctuation.
    .replace(/ +([.,;:!?…])/g, "$1")
    // A line that was ONLY an emoji, or only emoji plus punctuation, is now
    // blank punctuation. Leaving " ·" or "!!" reads as damage, not as removal.
    .replace(/(^|\s)[·•—–\-–—|,;:]+$/, "$1")
    .trim();


// Text STYLING left over from a source that published its own copy as
// markdown. The feed is rendered as plain text, so `**Steel Beans:**` and
// `*only*` reach the page with their markers intact — the reader sees the
// punctuation, not the emphasis it was meant to carry.
//
// Order matters and is the whole design. Paired markers go first, and only
// when they actually PAIR: `**...**` and `*...*` are stripped as pairs, so
// the asterisks in a bare `Hamdi**` (a name, followed by an orphaned closer
// with nothing open) are not treated as an opening. Stripping markers
// individually would delete that asterisk and silently corrupt the name.
//
// Underscores are NOT treated as markers at all. `_` occurs inside ordinary
// words and identifiers far more often than it denotes italics, and no
// description in either feed uses `_emphasis_`. Guessing here would corrupt
// more than it fixed.
//
// Backticks are code spans, not styling; they go with the rest.
const DECOR = /(?:\*\*|__)(?=\S)([\s\S]*?\S)(?:\*\*|__)|\*(\S(?:[^*]*?\S)?)\*|`([^`]*)`/g;

/** Remove markdown emphasis/code markers, keeping the words they wrapped. */
export const destyle = (s) =>
  String(s == null ? "" : s)
    .replace(DECOR, (_, a, b, c) => a ?? b ?? c ?? "")
    // A run of stars standing ALONE between two tokens — "] ** FREE" — is a
    // separator a source used for emphasis, not an unpaired opener with
    // content attached (that requires a non-space on both sides, which is why
    // the paired rule above leaves "Chromeo + **Toro y Moi" alone). Dropping
    // this one loses nothing: there is no marker to preserve, only a gap.
    .replace(/(?<=[\s\]\)])[*]{1,3}(?=[\s\[])/g, " ")
    // An orphaned closer left after a paired strip — e.g. a name that shipped
    // as `Hamdi**` with no opener. Trailing runs only, so a star that belongs
    // to the text is untouched.
    .replace(/(?<=[\w)])[*]{1,2}(?=[\s,.;:!?]|$)/g, "")
    .replace(/[*]{1,2}$/g, "")
    .replace(/[*]{1,2}(?<=\s\()/g, "")
    .replace(/`+/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();


// Strip markup and entities to plain, single-spaced text, bounded to `n`.
// Emoji go here too, and that is deliberate: `strip` is the last stop every
// scraped string passes through on its way into the feed, so stripping here
// covers every source in every city rather than the one that happened to need
// it this week. `deemoji` runs after the markup is gone, so an emoji encoded as
// an entity (`&#128512;`) has already become a character by this point and is
// caught; one left as a literal glyph is caught too. `destyle` runs innermost so
// the marker regex sees text that has not yet had its spacing collapsed — a
// `**bold**` pair stays paired at this point.
export const strip = (s, n = 240) =>
  deemoji(
    destyle(
      String(s || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
  ).slice(0, n);

// The HTML entities that leak out of scraped markup. `&amp;` is the common one,
// but sources also emit numeric references (`&#038;`, `&#x26;`), and a URL
// carrying one literally is broken: the query string reaches the destination
// with `&#038;` in it instead of `&`, which drops every parameter after the
// first.
const HTML_ENTITIES = {
  "&amp;": "&", "&#038;": "&", "&#x26;": "&", "&quot;": '"', "&#39;": "'",
  "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&#160;": " ",
};

// Decode a numeric character reference, decimal or hex. Word joins are the
// common case in real listing titles — "Beginner&#8217;s" was published with
// the raw reference visible on the page — so this is a general numeric decoder,
// not another entry in the table above. An allowlist cannot keep up: every
// punctuation mark Word emits is a different code point. Unknown code points
// (above 0x10FFFF, or a lone surrogate) are left intact rather than turned into
// a replacement character, so nothing is silently destroyed.
function fromCodePoint(cp) {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return null;
  if (cp >= 0xd800 && cp <= 0xdfff) return null;
  try {
    return String.fromCodePoint(cp);
  } catch {
    return null;
  }
}

export function decodeEntities(s) {
  return String(s)
    // Numeric first: &#8217; and &#x2019; both mean U+2019.
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (m, body) => {
      const cp = body[0] === "x" || body[0] === "X"
        ? parseInt(body.slice(1), 16)
        : parseInt(body, 10);
      return fromCodePoint(cp) ?? m;
    })
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m);
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

// "18:30" or "6:30 PM" -> minutes past local midnight, or -1 when unknown.
export function parseTimeToMinutes(t) {
  if (!t) return -1;
  const m = String(t).match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return -1;
  let hh = Number(m[1]);
  if (/pm/i.test(m[3] || "") && hh < 12) hh += 12;
  if (/am/i.test(m[3] || "") && hh === 12) hh = 0;
  return hh * 60 + Number(m[2]);
}

// Month abbreviation -> 0-based index, for pages that show "Oct 2" with no year.
export const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// One clock time, in the house style: "7:30 PM", "8 PM" (no ":00").
export const clock = (mins) => {
  if (mins == null || mins < 0) return null;
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  const mer = h >= 12 ? "PM" : "AM";
  const h12 = (h % 12) || 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")} ${mer}` : `${h12} ${mer}`;
};

// The displayed time, and the one place that decides its SHAPE.
//
//   both ends known, same day -> "5 PM -- 8 PM"
//   both ends known, next day -> "10 PM -- 2 AM (+1)"
//   only a start               -> "8 PM"      (never a bare "TBA" if we know one end)
//   neither                    -> "Time TBA"
//
// `+1` is not decoration: it makes a wrap-past-midnight span explicit at a
// glance, which is the difference between a listing you can read in half a
// second and one you have to check.
export function timeRangeLabel(startMinutes, endMinutes) {
  const a = clock(startMinutes);
  const b = clock(endMinutes);
  if (!a) return "Time TBA";
  if (!b || b === a) return a;
  // endMinutes is kept in its own 0-1439 frame, so an end at or before the
  // start can only be the next calendar day.
  const nextDay = endMinutes <= startMinutes;
  return nextDay ? `${a} -- ${b} +1` : `${a} -- ${b}`;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export const CATEGORIES = [
  "Concerts & Music",
  "Film & Movies",
  "Theater & Dance",
  "Comedy",
  "Art & Exhibits",
  "Festivals & Fairs",
  "Food & Drink",
  "Sports & Fitness",
  "Talks & Workshops",
  "Family & Kids",
  "Community",
];

// A source's own category vocabulary maps straight across. Both cities use it;
// DC's aggregators mostly publish no category at all, which is why the keyword
// pass below has to carry the whole weight there.
const MAP = {
  music: "Concerts & Music",
  comedy: "Comedy",
  "food & drink": "Food & Drink",
  "theatre & performing arts": "Theater & Dance",
  "theater & performing arts": "Theater & Dance",
  film: "Film & Movies",
  lgbtq: "Community",
  variety: "Theater & Dance",
  "sports & wellness": "Sports & Fitness",
  "arts & culture": "Art & Exhibits",
  "free & cheap": "Community",
  family: "Family & Kids",
  nightlife: "Concerts & Music",
  museum: "Art & Exhibits",
  "literary & book": "Talks & Workshops",
};

// Keyword fallback. These run on title + short excerpt, and the order matters:
// the first match per category wins, so a specific test claims the event before
// a broad one can. "class" and "show" are deliberately excluded — they pulled
// film screenings into Talks & Workshops and every concert into Family & Kids.
const KEYWORDS = [
  [/stand-?up|comedy|comedian|improv|sketch show|late show|open mic.*comedy|variety/, "Comedy"],
  [/cinema|movie|screening|film series|new release|double feature|\bfilm\b|\bdrafthouse\b|\bmovie night\b/, "Film & Movies"],
  [/theatre|theater|\bplay\b|musical|ballet|opera|\bdance\b|recital|choreograph|karaoke/, "Theater & Dance"],
  [/concert|live band|album release|\bgig\b|singer|songwriter|open mic|\bdj\b|headliner|orchestra|jazz/, "Concerts & Music"],
  [/gallery|gallery exhibit|museum|exhibit|art show|opening reception|artist talk|arts & culture|arts & exhibits/, "Art & Exhibits"],
  [/festival|\bfair\b|market|carnival|parade|block party|street fair|night market/, "Festivals & Fairs"],
  [/food|drink|brunch|dinner|wine|tasting|beer|cocktail|pairing|\bcook(?:ing)?\b|supper|\btea\b|restaurant/, "Food & Drink"],
  [/yoga|fitness|workout|\brun\b|running|hike|hiking|bike|cycling|climb|meditat|wellness|swim|sports? &/, "Sports & Fitness"],
  [/workshop|panel|lecture|\btalk\b|seminar|training|coaching|salon|discussion|book club|community meeting|author|poetry|storytelling/, "Talks & Workshops"],
  [/kids|children|family|toddler|all ages|playground|storytime|puppet|preschool/, "Family & Kids"],
  [/volunteer|cleanup|clean up|community|neighborhood|fundraiser|charity|civic|benefit/, "Community"],
];

// Legal and admissions boilerplate. These words sit in copy about getting into
// the room, not about what happens in it, and they were firing categories on
// events they have nothing to do with.
//
// The clearest case was a 21+ rap show tagged "Family & Kids". Nothing about it
// was family-friendly; the tag came from the venue's own admissions clause — in
// ticket copy "All Ages" means ages 6 and up, so it is a DISCLAIMER, not an
// offer.
const BOILERPLATE =
  /\b(?:all ages(?: admission)?|21 and (?:over|plus)|ages? 21\+|21\+|valid (?:photo )?id(?: required)?|id required|no (?:photo )?id|box office(?: window)?|will call(?: window)?|doors? (?:open|at)\b[^.]{0,24}|admission(?: (?:is|includes|prices?))?|free admission|required purchase|no re-?entry|tickets? (?:are|available)\b[^.]{0,24}|capacity|limited (?:seating|availability)|unclaimed tickets?|ticket(?:s)? required)\b/gi;

// Categories in descending order of how confidently the keyword pass assigns
// them. This ORDER is what decides which tags survive the cap.
const CATEGORY_RANK = {
  "Concerts & Music": 0,
  "Film & Movies": 1,
  "Theater & Dance": 2,
  Comedy: 3,
  "Festivals & Fairs": 4,
  "Art & Exhibits": 5,
  "Family & Kids": 6,
  "Food & Drink": 7,
  "Sports & Fitness": 8,
  "Talks & Workshops": 9,
  Community: 10,
};

// Evidence weight given to a category whose keyword appears in the TITLE.
const TITLE_MATCH = 0.34;

// How much of the listing's text supported this tag, as evidence-per-word. A
// ratio rather than a count: a concert listing that says "bar" once in 140
// words is not a Food & Drink event.
function evidenceRatio(hay, re) {
  const words = (hay.match(/\S+/g) || []).length;
  if (!words) return 0;
  const hits = hay.match(new RegExp(re.source, "gi")) || [];
  return hits.length / words;
}

// Build a case-insensitive matcher for one literal, escaping regex characters.
// The venue's own name is the other constant source of wrong tags: "Cafe du
// Nord" contains "cafe", which put Food & Drink on every concert held there.
const literalRe = (s) =>
  new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "gi");

/**
 * Decide what an event is FOR, from the source's own category where it has one
 * and from the rendered copy where it does not.
 *
 * `description` MUST be the same string the card renders. Tags derived from raw
 * text are justified by words the reader never sees, and the two disagree.
 */
export function categorize(rawCategory, title, description, venueName) {
  const mapped = MAP[(rawCategory || "").toLowerCase().trim()];
  const set = new Set();
  if (mapped) set.add(mapped);

  // Strip boilerplate and the venue echo BEFORE matching keywords, so "All Ages"
  // in an admissions clause cannot fire Family & Kids and a venue named for a
  // cafe cannot fire Food & Drink on its own concerts.
  let hay = `${title || ""} ${description || ""}`;
  hay = hay.replace(BOILERPLATE, " ");
  if (venueName) hay = hay.replace(literalRe(venueName), " ");
  hay = hay.toLowerCase();

  const titleLower0 = String(title || "").toLowerCase();

  for (const [re, cat] of KEYWORDS) if (re.test(hay)) set.add(cat);

  if (!set.size) return [mapped || "Community"];

  // A SINGLE candidate is not automatically correct. A tag has to be named by
  // the title or asserted by the source to survive on its own.
  if (set.size === 1) {
    const only = [...set][0];
    if (only === mapped) return [only]; // the publisher says so
    const rule = KEYWORDS.find(([, c]) => c === only);
    if (rule && rule[0].test(titleLower0)) return [only];
    return [mapped || "Community"];
  }

  // More than one candidate. Score each, then keep the best:
  //   - the source's own `category` field is never discarded on keyword evidence
  //     alone;
  //   - otherwise a tag has to earn its place.
  const scored = [...set].map((cat) => {
    const rule = KEYWORDS.find(([, c]) => c === cat);
    let evidence = 0.5; // asserted by the source's category field
    if (rule) {
      evidence = evidenceRatio(hay, rule[0]);
      if (rule[0].test(titleLower0)) evidence += TITLE_MATCH;
    }
    return {
      cat,
      rank: CATEGORY_RANK[cat] ?? 99,
      evidence,
      asserted: cat === mapped,
    };
  });

  // Credibility is RELATIVE, not absolute. A tag survives if the source asserted
  // it, or if the title names it, or if it holds at least a third of the
  // strongest tag's evidence.
  const best = Math.max(...scored.map((s) => s.evidence), 0);
  const kept = scored
    .filter((s) => s.asserted || s.evidence >= best * 0.33 || s.evidence > 0.12)
    .sort((a, b) => b.evidence - a.evidence || a.rank - b.rank);

  // The cap. Two at most, most relevant first.
  const result = kept.slice(0, 2).map((s) => s.cat);
  if (!result.length) return [mapped || "Community"];
  return result;
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------
// "free", "no cover", "complimentary" — the phrases a source uses when it means
// no money changes hands, as opposed to a source that simply states no price.
const FREE_WORDS = /\b(free|no cover|free admission|complimentary|free entry)\b/i;

// Prose that qualifies a price as NOT being the door price. A listing that
// says "VIP TABLES $800" is advertising the most expensive thing you can buy
// there; the admission price is some other number in the same sentence. Taking
// the first `$N` from such a line published "$800" as the cost of a $15 night.
// These words are checked before a bare number is taken from the copy path.
const NOT_THE_PRICE =
  /\b(vip|vip\s+table|vip\s+ticket|tables?|table\s+minimum|minimum|bottle|btl|brunch|menu|deposit|gratuity|tip|tips|private\s+event|room\s+fee)\b/i;

// Bounds for a believable ticket price. The ceiling matches the single-number
// path. The ratio exists to reject the absurd ($15-$800, where one end is a
// table price) but must not reject a genuinely wide range: "$20-$200" is a real
// early-entry-to-general-admission spread and is kept. The real discriminator
// is absolute size, so the ceiling does that work and the ratio is loose
// enough to pass any plausible door range while still catching table money.
const MAX_TICKET = 1500;
const MAX_SPREAD = 40;

/** The `$N` in this line, unless the line is describing something other than admission. */
function admissionPrice(text) {
  const t = strip(text || "");
  if (NOT_THE_PRICE.test(t)) {
    // Skip the clause that carries the qualifier and look again in the rest.
    // "VIP TABLES $800, admission $15" -> the trailing clause is the real one.
    const parts = t.split(/[,;.]|\band\b|\bbut\b/i);
    for (let i = parts.length - 1; i >= 0; i--) {
      const seg = parts[i];
      if (NOT_THE_PRICE.test(seg)) continue;
      if (FREE_WORDS.test(seg)) return null;
      const m = seg.match(/\$\s?(\d{1,4}(?:\.\d{2})?)/);
      if (m) {
        const n = parseFloat(m[1]);
        if (n > 0 && n <= MAX_TICKET) return n;
      }
    }
    return null;
  }
  const m = t.match(/\$\s?(\d{1,4}(?:\.\d{2})?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_TICKET) return null;
  return n;
}

/**
 * Read a price out of a structure first and out of the copy second.
 *
 * `structured` is a field the source itself provides (DoTheBay's
 * `ticket_info`, a ClockOut DC "(6-8:30pm, $15)" annotation). It beats prose:
 * a listing whose body says "tickets from $10" while its price field says
 * "Free" is telling you about a different night.
 *
 * `assertedPaid` is the source saying "not free, I just did not publish the
 * amount" — see the "Ticketed" note in the caller's own copy.
 */
export function priceFrom({ structured, text, isFree, assertedPaid, overrides } = {}) {
  if (isFree) return { label: "Free", tier: "free" };

  // A range is only believable if BOTH ends are plausible ticket prices and
  // they are in a sane proportion. The single-number path below already
  // rejects anything over 1500; the range path had no equivalent check, so a
  // VIP table price ($800) or a table minimum ($1200) scraped out of a
  // listing body was published as the cost of admission — "$15–$800" and
  // "$100–$1200" both shipped that way. The bounds are deliberately loose
  // (a genuinely expensive night exists); the RATIO is the real test, because
  // no door price spans two orders of magnitude within one event.
  const rangeOk = (lo, hi) => {
    const a = parseFloat(lo), b = parseFloat(hi);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (a <= 0 || b <= 0) return false;
    if (a > MAX_TICKET || b > MAX_TICKET) return false;
    return Math.max(a, b) / Math.min(a, b) <= MAX_SPREAD;
  };

  const info = String(structured || "");
  // A structured field can carry a table price too, so it gets the same
  // qualifier check as prose. "VIP table $1200" is not a range.
  const infoQualified = NOT_THE_PRICE.test(info);
  if (info) {
    const range = info.match(/\$\s?(\d{1,4}(?:\.\d{2})?)\s?(?:-|–|—|to)\s?\$?\s?(\d{1,4}(?:\.\d{2})?)/);
    if (range && !infoQualified && rangeOk(range[1], range[2])) {
      return { label: `$${range[1]}–$${range[2]}`, tier: "paid" };
    }

    const one = info.match(/\$\s?(\d{1,4}(?:\.\d{2})?)/);
    if (one) {
      const n = parseFloat(one[1]);
      if (n === 0) return { label: "Free", tier: "free" };
      return { label: `$${n % 1 ? n.toFixed(2) : n}`, tier: "paid" };
    }
    if (FREE_WORDS.test(info)) return { label: "Free", tier: "free" };
  }

  // A price resolved at the box office itself beats anything scraped from the
  // listing copy.
  if (overrides?.label) return { label: overrides.label, tier: "paid" };

  const copy = strip(text || "");
  const r2 = copy.match(/\$\s?(\d{1,4}(?:\.\d{2})?)\s?(?:-|–|—|to)\s?\$?\s?(\d{1,4}(?:\.\d{2})?)/);
  // Same gate as the structured range above: a range scraped from prose is the
  // likeliest place to pick up a table minimum or a phone fragment by mistake.
  // If it fails the gate, fall THROUGH rather than returning — the single-number
  // branch below may still find the real door price in the same sentence.
  if (r2 && rangeOk(r2[1], r2[2])) return { label: `$${r2[1]}–$${r2[2]}`, tier: "paid" };

  const r1 = copy.match(/\$\s?(\d{1,4}(?:\.\d{2})?)/);
  if (r1) {
    // Prefer admissionPrice(): it knows that "VIP TABLES $800" is not the door
    // price and will look past that clause for the real one. Falls back to the
    // plain first-number read when the line is not qualified.
    const adm = admissionPrice(copy);
    if (adm != null) {
      return { label: `$${adm % 1 ? adm.toFixed(2) : adm}`, tier: "paid" };
    }
    const n = parseFloat(r1[1]);
    if (n === 0) return { label: "Free", tier: "free" };
    // Ignore year-like and zip-like numbers scraped out of prose.
    if (n > 1500) return { label: null, tier: "unknown" };
    return { label: `$${n % 1 ? n.toFixed(2) : n}`, tier: "paid" };
  }

  if (FREE_WORDS.test(copy)) return { label: "Free", tier: "free" };

  // "Ticketed" rather than a number, on purpose. Printing a guessed amount here
  // would be a guess dressed as a fact on a page whose whole claim is that it
  // links you to the real thing. The row links straight to the box office.
  if (assertedPaid) return { label: "Ticketed", tier: "ticketed" };

  return { label: null, tier: "unknown" };
}

/**
 * Round a price label to whole dollars, for DISPLAY only.
 *
 * The aggregators charge in cents — "$22.46", "$27.51" — and those figures get
 * copied straight into the price tag, where they read as more precision than a
 * listing actually carries. The tag answers "can I afford this", so whole
 * dollars are the right resolution: $22.46 -> $22.
 *
 * Only the label is rounded. `priceTier` is decided by priceFrom() from free
 * wording and structured fields, never from the rendered number, so rounding a
 * display string cannot move an event between the free/paid counts.
 *
 * Left untouched, because they are not amounts:
 *   - "Free" / "Ticketed"  — no number to round
 *   - null / undefined     — nothing was published, which is real information
 *   - anything with no "$"  — a label shape we do not recognise. Round nothing
 *                            rather than guess at text we have never seen.
 *
 * Ranges round each end on its own, so "$22.46–$27" becomes "$22–$27". Rounding
 * the whole range from its midpoint would be worse than either end: it would
 * invent a low end the venue did not quote.
 */
export function roundPriceLabel(label) {
  if (typeof label !== "string" || !label.includes("$")) return label;
  return label.replace(/\$(\d+(?:\.\d+)?)/g, (whole, num) => {
    const n = parseFloat(num);
    if (!Number.isFinite(n)) return whole;
    // Round half UP, so $22.50 is $23 rather than the banker's-rounding $22 that
    // Math.round would give for some values and a reader would find surprising.
    return `$${Math.round(n + 1e-9)}`;
  });
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------
// Hosts whose page is an AGGREGATOR's, not the venue's or organizer's. The
// reader is told which tier a link is, so badging an aggregator "Venue site"
// sends them somewhere the site said it would not.
//
// The subdomain prefix must be OPTIONAL and quantified (`(.+\.)?`), not `(.|.)`:
// the latter needs a character before the dot, so it never matches a bare host
// ("bit.ly", "t.co") and silently passes every real shortener straight through.
export const AGGREGATOR_HOSTS =
  /(.+\.)?(dothebay\.com|dostuffmedia\.com|eventbrite\.[a-z.]{2,6}|dostuff\.com|allevents\.in|evvys\.com|sfweekly\.com|sfchronicle\.com|funcheap\.com|eventup\.com|patch\.com|do512\.com|popville\.com|dcist\.com|washingtonian\.com|bit\.ly|pxf\.io|t\.co|is\.gd|lnkd\.in|buff\.ly|tinyurl\.com)$/i;

// Hosts that SELL tickets for the venue, on the venue's behalf. When the venue
// has no site of its own this is the closest thing to one, so it is kept and
// labelled "box office". This deliberately includes white-label sellers.
export const TICKETING_HOSTS =
  /(^|\.)(ticketmaster\.(com|evyy\.net)|axs\.com|shop\.axs\.com|seetickets\.(us|com|co\.uk|net)|wl\.seetickets\.[a-z.]+|veezi\.com|veezi\.tv|ticketing\.uswest\.veezi\.com|dice\.fm|scuff\.us|dnnr\.io|feourala\.com|showsafe\.com|onebox\.tickets|eventbrite\.com|ticketleap\.com|eventy\.com|partiful\.com|givecloud\.co|vbz\.com)$/i;

// A social profile is where an event gets *announced*, not where tickets are
// sold and not the venue's own page. Demoted to "listing" so the badge matches.
export const SOCIAL_HOSTS =
  /(^|\.)(facebook\.com|instagram\.com|twitter\.com|x\.com|threads\.net|bsky\.app|linkedin\.com|meetup\.com|youtube\.com|tiktok\.com|tumblr\.com|mastodon\.social|bsky\.social)$/i;

const SHORTENER_RE =
  /(.+\.)?(bit\.ly|pxf\.io|t\.co|lnkd\.in|goo\.gl|ow\.ly|is\.gd|buff\.ly|tinyurl\.com|cutt\.ly|t\.ly)$/i;

// Prefer https, but only where the host actually serves it. A link a visitor
// clicks has to work, and a forced https on a host without TLS is a dead link.
const tlsCache = new Map();

function servesHttps(host) {
  if (tlsCache.has(host)) return tlsCache.get(host);
  let ok = false;
  try {
    // Any HTTP status counts: a 404 still proves the TLS handshake completed.
    const code = execFileSync("curl", ["-sI", "--max-time", "6", "-o", "/dev/null",
      "-w", "%{http_code}", `https://${host}/`], { encoding: "utf8", timeout: 8000 }).trim();
    ok = /^[1-9]\d\d$/.test(code);
  } catch { ok = false; }
  tlsCache.set(host, ok);
  return ok;
}

export function safeUrl(href) {
  try {
    const u = new URL(decodeEntities(href));
    // Only ever hand out http(s); a javascript: or data: href from scraped
    // markup must not survive into the page.
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.protocol === "http:" && servesHttps(u.hostname)) u.protocol = "https:";
    return u;
  } catch {
    return null;
  }
}

// Small synchronous HTTP HEAD helper. Node has no sync fetch, so this shells out
// to curl, which is present everywhere this runs and needs no dependency.
function fetchSync(url) {
  try {
    const out = execFileSync("curl", ["-sIL", "--max-time", "8", "-o", "/dev/null",
      "-w", "%{url_effective}", url], { encoding: "utf8", timeout: 9000 });
    return out ? { url: out.trim() } : null;
  } catch {
    return null;
  }
}

// Some buy links are tracking wrappers that carry the real destination in a
// query parameter (?u=, ?redirect=, ?url=). Unwrap so the link a person clicks
// points at the venue or its box office rather than a redirector.
function followShortener(u) {
  if (!SHORTENER_RE.test(u.hostname)) return u;
  let cur = u.toString();
  for (let i = 0; i < 5; i++) {
    const res = fetchSync(cur);
    const next = res?.url || null;
    if (!next || next === cur) break;
    const nu = safeUrl(next);
    if (!nu) break;
    cur = nu.toString();
    if (!SHORTENER_RE.test(nu.hostname)) break; // reached the real destination
  }
  return safeUrl(cur) || u;
}

export function unwrapTracker(href) {
  const u = safeUrl(href);
  if (!u) return null;

  for (const key of ["u", "url", "redirect", "target", "to", "dest"]) {
    const raw = u.searchParams.get(key);
    if (!raw) continue;
    let inner = raw;
    try { inner = decodeURIComponent(raw); } catch { /* already decoded */ }
    // Only accept an absolute http(s) target, and never recurse into another
    // wrapper on the same host.
    if (/^https?:\/\//i.test(inner)) {
      const iu = safeUrl(inner);
      if (iu && iu.hostname !== u.hostname) return followShortener(iu);
    }
  }
  return followShortener(u);
}

export function anchorsIn(html) {
  const out = [];
  const re = /href=["'](https?:\/\/[^"'>\s]+)["']/gi;
  let m;
  while ((m = re.exec(html || ""))) {
    const u = safeUrl(m[1]);
    if (u) out.push(u);
  }
  return out;
}

// Does this host look like the venue's own site rather than a seller?
export function isVenueSite(url, venueName) {
  if (AGGREGATOR_HOSTS.test(url.hostname)) return false;
  if (TICKETING_HOSTS.test(url.hostname)) return false;

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const core = host.split(".").slice(0, -2).join(".");

  // A ticket path on the venue's own domain is still the venue's page.
  if (venueName) {
    const v = venueName.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const c = core.replace(/[^a-z0-9]+/g, "");
    if (c && (c.includes(v) || v.includes(c))) return true;
  }
  return true; // a plain non-ticketing site beats an aggregator page
}

// The venue's own page, found in an event's copy. Returns the URL OBJECT, not a
// string: linkTier() below reads outbound.hostname to decide the tier, and a
// string's .hostname is undefined, which silently skipped every host check.
export function venuePageFrom(html, venueName) {
  for (const u of anchorsIn(html)) {
    if (isVenueSite(u, venueName)) return u;
  }
  return null;
}

/**
 * Which of the three honest answers to "where does this link go?" a URL is.
 *   venue     — the venue or organizer's own website
 *   boxoffice — a ticketing seller acting as that venue's official box office
 *   listing   — an aggregator's page, used only when nothing else exists
 */
export function linkTier(url, venueName) {
  if (!url) return "listing";
  if (AGGREGATOR_HOSTS.test(url.hostname)) return "listing";
  if (SOCIAL_HOSTS.test(url.hostname)) return "listing";

  if (TICKETING_HOSTS.test(url.hostname)) {
    // Some sellers host the venue's site themselves (axs.com/venue, etc.).
    const core = url.hostname.replace(/^www\./, "").toLowerCase().split(".").slice(0, -2).join(".");
    if (venueName) {
      const v = venueName.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const c = core.replace(/[^a-z0-9]+/g, "");
      if (c && (c.includes(v) || v.includes(c))) return "venue";
    }
    return "boxoffice";
  }
  return "venue";
}

// ---------------------------------------------------------------------------
// Sold out
// ---------------------------------------------------------------------------
// The ONLY trusted signal is the source's own flag. Matching on the event copy
// was wrong in both directions: "this tour included sold-out shows nationwide"
// is the artist's back-catalogue, not tonight's ticket status.
export const SOLD_OUT_RE =
  /\b(sold[\s‐-]?out|sell(?:ed)?[\s‐-]?out|out of stock|no (?:more )?(?:tickets|seats) (?:available|remaining)|at capacity|fully booked)\b/i;

export function soldOut(e = {}, raw = "") {
  if (e.sold_out === true || e.sold_out === "true") return true;
  if (e.soldOut === true || e.soldOut === "true") return true;

  // A copy-level match counts only when it is a *status statement* about this
  // event: it has to sit at the start of a line or follow a sentence break, and
  // it must not be qualifying a past tour.
  if (!SOLD_OUT_RE.test(String(raw || ""))) return false;

  // Sentence-scoped, not window-scoped: the historical evidence is often far
  // from the phrase and on either side of it.
  const raw2 = String(raw || "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // Re-find the phrase in the cleaned text: tag-stripping shifts every offset.
  const hit2 = SOLD_OUT_RE.exec(raw2);
  if (!hit2) return false;
  const at = hit2.index;

  const start = Math.max(
    raw2.lastIndexOf(".", at - 1) + 1,
    raw2.lastIndexOf("!", at - 1) + 1,
    raw2.lastIndexOf("?", at - 1) + 1,
    0);
  let end = raw2.length;
  for (const ch of [".", "!", "?", "\n"]) {
    const i = raw2.indexOf(ch, at);
    if (i !== -1) end = Math.min(end, i);
  }
  const sentence = raw2.slice(start, end).trim();
  const hay = sentence.toLowerCase();

  // Present-tense, about this event.
  if (/\b(this|these)\s+(show|gig|event|performance|concert|one|tickets?)\b/.test(hay)) return true;
  if (/\b(tickets?|seats?|admission)\b[^.!?]{0,30}\b(are|is|were|has|have|had)\b/.test(hay)) return true;

  // A phrase immediately followed by a question mark is a question, not a
  // status: "Sold out? Ask about returns at the door" is an invitation to ask.
  if (raw2[at + hit2[0].length] === "?") return false;

  // Otherwise the sentence is history unless it talks about tonight. These run
  // BEFORE the short-banner shortcut: a one-line promo is exactly the shape most
  // likely to be about something else — a past show, a record, a record-breaking
  // run — so length has to be the last resort, not the first.
  if (/\b(prev|previous|last|prior|past|formerly|once|earlier|since|through|co-?headline|back-?catalogue|catalogue|tour|tours|nationwide|national|history|previously|record[- ]breaking|landmark|record[- ]set|album|discography|returns?|returning|reprise|revival|again|re-?issue|archive|encore)\b/.test(hay)) return false;
  if (/\b(19|20)\d{2}\b/.test(hay) || /\b(19|20)\d{2}\b/.test(raw2)) return false;

  // Conditional or hypothetical: "when tickets sell out" is a future
  // possibility, not this listing's state.
  if (/\b(when|if|unless|should|would|could|might|may|hope|hopefully|wait ?list|rain ?check|how|why)\b/.test(hay)) return false;

  // "sell out" with a non-ticket subject is an observation about the world.
  if (/\bsell(?:s|ing)?\s*out\b/i.test(hay)
      && !/\b(tickets?|seats?|passes|admission|entry|shows?|concerts?|gigs?)\b/i.test(hay)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Cancellations
// ---------------------------------------------------------------------------
// A row whose TITLE says it is not happening is not a listing. Sources publish
// these by prepending to the title ("CANCELLED Sofar Sounds — Concord") and the
// event itself stays in the feed with a future date.
//
// Anchored on a word boundary and matched against the whole title, so it catches
// "Cancelled:", "CANCELLED ", "Show Cancelled" and "Event canceled" while
// leaving alone a legitimately-named show that merely contains the letters —
// "The Canceled Wedding" is a real production.
export const CANCELLED_RE = /\b(cancell?ed|postponed|rescheduled)\b/i;

export const isCancelledTitle = (title) => CANCELLED_RE.test(title || "");

// Titles a source prefixes for administrative reasons rather than because the
// event is off: a private booking, a buyout, or a venue closure. Same treatment,
// separate pattern so the count can tell them apart.
export const CLOSED_RE = /private|buyout|closed for/i;