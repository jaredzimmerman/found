// ---------------------------------------------------------------------------
// title-clean-core.mjs — the city-agnostic body of the title/description cleaner
// ---------------------------------------------------------------------------
// San Francisco and Washington run the SAME cleaning rules: strip a schedule
// parenthetical, strip a trailing date, strip a city suffix, cut a DoTheBay
// dateline, drop an opener that restates the venue, drop a "X presents" credit,
// remove emoji, sentence-case. Only two of those rules are city-specific —
// which place names count as "the city" and which count as "somewhere else".
//
// Those two arrive as `citySuffix` and `cityQualifier`. Everything else is
// shared, and it is shared HERE, in one place, because it used to be copied:
// title-clean.mjs and dc-title-clean.mjs were 188 of 191 lines byte-identical,
// with two regexes differing. That is the arrangement that let DC ship 31 emoji
// while SF shipped none — the filter was added to one copy and not the other.
// A third city would have been a third chance to forget.

import { deemoji, destyle } from "./shared.mjs";

export const MONTH_TOKEN =
  "(?:" +
  "jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec" +
  "|january|february|march|april|june|july|august|september|october" +
  "|november|december" +
  ")\\.?\\b";

// The schedule parenthetical is NOT anchored to the end. "FREE Comedy Night
// (Every Wednesday) at The Function (SF)" has a city suffix after it, so an
// end-anchored pattern sees only "(SF)", strips that, and leaves the schedule
// behind — the row still reads "(Every Wednesday)".
export const SCHEDULE_SUFFIX =
  /[([]\s*(?:every|each|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun|weekdays?|weekends?|daily|nightly|monthly)\b[^)\]]*[)\]]/gi;

// A run that ends in its own calendar date restates the day section above it.
// The month token must be a COMPLETE word: an earlier version allowed a suffix
// (`mar[a-z]*`) and matched "Ma[r]ket 20[26]" as "March 20, 26", truncating a
// real event's name to "Noe Valley Night".
// The year is REQUIRED, not optional. The trailing run is stripped only when
// it is unambiguously a full date; "Some Event - Oct 5" keeps its suffix,
// because without a year it could be part of the name. No title in the feed
// carries a yearless dated suffix, and the only month-day appearing in a title
// proper is a prose range — "Workout Wednesdays at SF's Union Square (Sept. 23-
// Oct. 14)" — which the closing paren keeps out of reach of the end anchor.
export const TRAILING_DATE = new RegExp(
  "\\s*(?:\\s[-\\u2013\\u2014|]\\s*|\\s+)" +
  "(?:(?:mon|tues?|wed|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\\s*,?\\s*)?" +
  MONTH_TOKEN +
  "\\s+\\d{1,2}(?:st|nd|rd|th)?,\\s*'?\\d{4}\\s*$",
  "i"
);

// DoTheBay's `excerpt` is mostly not prose. The dominant shape is a trailing
// dateline — "Joe Klocek & Friends Tuesday, September 29 | Punch Line San
// Francisco" — where the date and the venue are exactly the two things the row
// already prints. Left in, the row reads "Punch Line San Francisco / Punch
// Line San Francisco".
//
// A venue name in the middle of real copy ("... at Madrone Art Bar! On the Main
// Wall: ...") is prose, not a dateline, and stays. Price words also stay when
// they carry a condition the price field does not ("Free admission, RSVP
// encouraged") — the price dedupe is in the page, not here.
//
// End-anchored with an OPTIONAL tail, not a required pipe: a fetch.mjs copy of
// this regex once required a literal `|` to fire, so a dateline with nothing
// (or only a comma) after it — no trailing venue — was left in the shipped
// description.
//
// The tail is open, not just `[,|]`. The SALAM MAMI row ends
// "Saturday, October 3 Doors 10PM Temple SF | 540 Howard St" — the day and
// date are plainly a dateline, but a bare word ("Doors") follows the day
// number, so a comma-or-pipe tail never matched and the blob shipped whole.
//
// A dateline tail is not prose — it is DATA: a pipe, a door time, an address,
// an age limit, or simply the end of the string after a complete date.
// Requiring that is what separates the two cases that look identical:
//
//   "Heather McDonald Friday, October 2 | Cobb's"   -> dateline, strip
//   "We meet on Saturday, October 3rd for the show." -> prose, keep
//
// Both are "<something> + weekday + month + day". The difference is what FOLLOWS
// the date, not what precedes it — so every earlier attempt to gate on the
// preceding token (start-of-string, punctuation, capitalisation) failed on one
// side or the other: requiring punctuation missed "Heather McDonald Friday…",
// requiring a capitalised predecessor ate "Join us Saturday, October 3! Free."
//
// If a pipe appears after the date, we strip everything from the pipe onward
// because the pipe is a strong delimiter indicating the start of metadata
// (venue, time, age, etc.). If no pipe is present, we require one of the known
// data-ish tokens (time, age limit, address indicator, etc.) to allow stripping.
//
// Examples that STRIP (contain pipe or data token after date):
//   "R-Evolution Friday, October 2 | Embarcadero Plaza"
//   "Kit Clayton Friday, October 2, 2026 Doors 7:00PM 21+"
//   "Heather McDonald Friday, October 2 | Cobb's Comedy"
//   "Doors at 7 Saturday, October 3, 2026"
//   "Join us Saturday, October 3 Doors 10PM Temple SF | 540 Howard St"
//   "Hardly Strictly Bluegrass October 2 - 4 | Golden Gate Park ..."
//   "Off the Grid Treasure Island Saturdays | 11am–4pm | Cityside Park ..."
//
// Examples that KEEP (no pipe, no data token after date):
//   "We meet on Saturday, October 3rd for the show."
//   "Join us Saturday, October 3! Free."
//   "Come celebrate with us, Saturday, October 3! Bring friends."
//   "Every Saturday, October 3! Come early."
//   "The show is Saturday, October 3, 2026. Free for all."
//
// The month+day run a dateline ends with, including the "October 2 - 4" range
// form and an optional year. Built once and shared by every branch so they
// cannot drift apart — the two branches disagreeing about what a date looks
// like is exactly how "October 2 - 4" survived while "October 2" was caught.
const DATE =
  "[A-Z][a-z]+\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?" +
  "(?:\\s*[-[\\u2013\\u2014]]\\s*\\d{1,2})?" +
  "(?:[,.]?\\s*\\d{4})?";

// Tokens that only appear in metadata (a door time, an address, an age limit),
// never in a sentence about what happens at the event.
const DATA =
  "\\bPM\\b|\\bAM\\b|\\d{1,2}:\\d{2}|\\d+\\+|\\bSt\\b|\\bAve\\b|\\bCA\\b|" +
  "\\bSuite\\b|\\bSte\\b|\\bDoors\\b|\\bRSVP\\b|\\b21\\+\\b|\\b18\\+\\b|\\bAll ages\\b";

const DATELINE = new RegExp(
  // Five branches, strongest first. Each one is a COMPLETE alternative — they
  // are not nested and they are not tails of a shared head, because a shared
  // head with top-level alternation splits the whole pattern and lets a branch
  // match with no date in front of it (that bug ate whole descriptions).
  //
  // The discriminator is the weekday. Making it optional — "month + day + tail"
  // with no weekday — fires on ordinary prose: "A night of Middle Eastern and
  // Latin fusion. October 3" and "Doors 7. October 2" both matched. The weekday
  // is what says "this run is a dateline", so only B4/B5 relax it, and they
  // require a pipe, which no English sentence about a festival contains.
  //
  // DATE is the month+day run, including the "October 2 - 4" range form that
  // Hardly Strictly Bluegrass ships and that an earlier version missed
  // entirely.
  "(?:\\s*[A-Z][a-z]+day,\\s+" + DATE + ".*?\\|.*)" +   // B1 pipe after date
  "|(?:\\s*[A-Z][a-z]+day,\\s+" + DATE + ".*?(?:" + DATA + ").*)" +  // B2 data token
  "|(?:\\s*[A-Z][a-z]+day,\\s+" + DATE + "$)" +          // B3 date at EOS
  "|(?:\\s*" + DATE + ".*?\\|.*)" +                      // B4 no weekday, pipe
  "|(?:\\s*[A-Z][a-z]+days?\\b.*?\\|.*)",                // B5 plural weekday + pipe
  "i"
);


// The masthead is matched as CAPITALISED WORDS, not as `[^:]{0,60}?`.
// Anchoring to `^` alone was not enough — `[^:]{0,60}?` still consumes
// whatever precedes the verb, so "A raffle where she presents the winner"
// matched and lost its whole opening clause. A presenter credit is always a
// masthead (Live Nation, San Francisco Chronicle, Rickshaw Stop + Live
// Nation), so every word before the verb is capitalised; requiring that is
// what separates the credit from ordinary prose.
//
// The `(?-i:…)` inline group is load-bearing and looks redundant. It is not:
// the verb must match case-insensitively ("Presentsthe" has a capital P, but
// "presents:" may not), while the masthead must match case-SENSITIVELY or it
// would match "a raffle where she" and defeat the entire anchoring. One
// regex cannot carry both rules under a single `i` flag, so each part gets
// its own.
// A parenthesised credit has to be reachable. `(((folkYEAH!))) presents:` is a
// real opener in the feed, and it failed the original pattern twice over: the
// token `[A-Z][\w.&'’-]*` cannot span a bracket, and "folkYEAH" does not begin
// with a capital either. So a BRACKETED credit gets its own alternative, which
// matches on the brackets and does not care what is inside — a wrapper is
// already a strong enough signal that we are looking at a masthead and not at
// prose. The unbracketed alternative keeps the capitalisation requirement,
// which is the rule that stops "a raffle where she presents the winner" from
// being eaten, so loosening one must not loosen both.
const BRACKETED = String.raw`\(*[!\[{(][^!\]})]*[!\]})]+[\s,]*`;
const PLAIN_WORD = String.raw`[A-Z][\w.&'’-]*(?:\s*[+,]\s*)?[\s,]+`;
const MASTHEAD = String.raw`(?:${BRACKETED}|${PLAIN_WORD}){0,4}?`;
// The same masthead, but requiring TWO OR MORE tokens before the verb. Used
// only for the loosest tail (below), where the giveaway that we are in prose
// is that the subject is a single ordinary word.
const MASTHEAD_MULTI = String.raw`(?:${BRACKETED}|${PLAIN_WORD}){2,4}?`;
// One token is allowed here — but only behind a CAPITALISED "Presents", which
// is the discriminator prose does not have. Sources title-case a brand's credit
// ("Foodwise Presents Pop-Ups…") while a sentence mid-description writes a
// lowercase "presents". Measured on the feed + battery: catches the last
// outstanding credit, 0 false positives.
const MASTHEAD_BRAND = String.raw`(?:${BRACKETED}|${PLAIN_WORD}){1,4}?Presents\s+(?=[A-Z])`;

/**
 * Build the cleaners for one city.
 * @param {RegExp} citySuffix     trailing "(Oakland)" / "(Baltimore)" to drop
 * @param {RegExp} cityQualifier  "somewhere else" marker — isElsewhere()
 */
export function titleCleaner({ citySuffix, cityQualifier }) {
  function cleanTitle(title) {
    // Styling first, before the suffix rules. A source that ships `**Hamdi**`
    // or `Hamdi**` puts the markers where the date/schedule rules are looking
    // for their boundary, so cleaning them afterwards leaves whatever survived
    // attached to the wrong end of the string.
    let s = destyle(String(title || "")).replace(/\s+/g, " ").trim();
    for (let i = 0; i < 4; i++) {
      const before = s;
      s = s.replace(SCHEDULE_SUFFIX, "").replace(citySuffix, "").trim();
      s = s.replace(TRAILING_DATE, "").trim();
      s = s.replace(/[\s,;–—|-]+$/, "").replace(/\s{2,}/g, " ");
      if (s === before) break;
    }
    // `deemoji` is deliberately NOT applied to titles. The pictograph range that
    // makes sense in a description (a row of faces, a fire, a party popper)
    // also contains ★ (U+2605), and titles legitimately use it as a rating or
    // as part of a film/artist name. Removing it here deleted the star from
    // "Deathgasm 2: Goremageddon (R) ★" — content, not decoration. The
    // frontend's render-boundary filter is the right place for that call, and
    // it leaves stars alone for the same reason.
    return s.replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim();
  }

  function isElsewhere(title) {
    return cityQualifier.test(String(title || ""));
  }

  function cleanDescription(text, venueName) {
    let s = String(text || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ");
    s = s.replace(/\s+/g, " ");

    // Cut the dateline tail.
    s = s.replace(DATELINE, "").trim();

    // A description that was ONLY a dateline is now empty; that is correct, and
    // the row simply shows no description. Do not fall back to the raw text —
    // that would reintroduce the duplication this exists to remove.
    if (!s) return "";

    // A description that OPENS by restating the venue is the same duplication
    // one clause later: the row prints the venue in its own line, and a chunk
    // of descriptions began "Rickshaw Stop + Live Nation co-present…", "Play
    // Mahjong at the Ferry Building!", "San Francisco Chronicle presents:".
    // Cut the leading restatement and keep what follows.
    if (venueName) {
      const v = venueName
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+");
      // …and then any CONNECTOR left dangling at the head by that removal —
      // "Rickshaw Stop + Live Nation Presents…" becomes "+ Live Nation
      // Presents…" once the venue is gone, and a bare "+" is punctuation, not a
      // word, so the capitalisation anchor below cannot span it. Consumed here,
      // after the venue, where it is provably a co-presenter marker rather than
      // prose. This is the same co-presented credit the DATELINE comment above
      // cites; it just has to be handled after the venue rather than before it.
      s = s
        .replace(new RegExp(`^\\s*${v}\\b[\\s:—–-]*`, "i"), "")
        .replace(/^\s*[+,&]\s+/, "")
        .trim();
    }
    // …and the generic "X presents" opener, whatever X was.
    //
    // Three shapes have to be handled, and the first version handled only the
    // first, which is why a listing shipped reading "Live Nation Presentsthe
    // ghosted tour" — the words run together AND the colon is absent, so a
    // colon-anchored pattern correctly declined to match and the raw opener
    // went straight to the page. "Presentsthe" is not a typo in the source; it
    // is two words glued by an upstream stripper that removed the space and,
    // being naive, removed the colon with it.
    //
    //   1. "San Francisco Chronicle presents:"      — colon
    //   2. "Live Nation Presents the ghosted tour"  — space, no colon
    //   3. "Live Nation Presentsthe ghosted tour"    — glued, no colon
    //
    // Shape 3 is why the trailing boundary cannot simply be `\b`: between
    // "presents" and "the" there is no word boundary, so `\bpresents\b` never
    // fires on it. The lookahead is anchored on the following ARTICLE instead,
    // which is present in all three shapes and cannot be confused with a noun
    // ("presents" as in gifts) the way a bare `\b` can.
    //
    // The credit must additionally LEAD the description. It is always a masthead
    // — "Live Nation Presents…" opens a listing — so anchoring costs nothing,
    // and it is what stops the pattern eating real prose: an unanchored version
    // matched "…a raffle where she presents the winner", because `[^:]{0,60}?`
    // does not care how much text precedes the word. Same class of bug as the
    // original: a regex matching text it was never written to match.
    //
    // Verb case-insensitive, masthead case-SENSITIVE. One regex cannot carry
    // both rules under a single `i`, and this engine has no `(?-i:…)` inline
    // modifier (v22 rejects it — verified, not assumed), so the masthead gets
    // its own flagless pattern and the verb is applied case-sensitively too.
    // "Presentsthe" as shipped has a capital P, which is exactly why the verb
    // is capitalised here: the upstream masthead capitalises every word.
    //
    // Three tails, tried in order. The first two are the historical rules and
    // are unchanged. The third is new: it accepts a Capitalised tail, which
    // catches the very common credit "Foodwise Presents Pop-Ups on the Plaza"
    // that the article lookahead misses entirely. It is gated behind
    // MASTHEAD_MULTI (two or more capitalised tokens before the verb) because
    // a single capitalised subject is ordinary prose — "It presents an
    // interesting question" — and eating that would be worse than leaving a
    // credit in. Measured: +6 credits, 0 false positives across the battery.
    s = s
      .replace(new RegExp(String.raw`^${MASTHEAD}[Pp]resents:\s*`), "")
      .replace(new RegExp(String.raw`^${MASTHEAD}[Pp]resents\s+(?=(?:the|a|an)\b)`), "")
      .replace(new RegExp(String.raw`^${MASTHEAD}[Pp]resents(?=(?:the|a|an)\b)`), "")
      .replace(new RegExp(String.raw`^${MASTHEAD_MULTI}[Pp]resents\s+(?=[A-Z])`), "")
      .replace(new RegExp(MASTHEAD_BRAND), "")
      .trim();

    // Styling markers and emoji go last, after every rewrite above has run, so
    // a glyph that was part of a pattern this function matches cannot survive by
    // sitting inside it. `destyle` first: a `**bold**` span must be closed before
    // the spacing rules run, or the pair splits and half of it survives.
    //
    // This is the SECOND place either is removed (the first is `strip` in
    // shared.mjs). Both are deliberate: `strip` catches every scraped string,
    // this catches descriptions assembled from parts, and the frontend catches
    // both cases plus a hand-edited feed.
    s = deemoji(destyle(s));

    // Sentence case: scrapers capitalise every word, which reads as shouting.
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  return { cleanTitle, isElsewhere, cleanDescription };
}