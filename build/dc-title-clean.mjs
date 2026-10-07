// ---------------------------------------------------------------------------
// Titles and descriptions — Washington
// ---------------------------------------------------------------------------
// Identical rules to San Francisco; only the place-name lists differ. The
// cleaner itself is titleCleaner() from title-clean-core.mjs.
//
// This file used to be a byte-for-byte copy of the SF module with two regexes
// swapped, and that is how DC shipped 31 emoji while SF shipped none: the
// emoji filter was added to one copy and not the other. Two regexes are all
// that live here now.

import { titleCleaner } from "./title-clean-core.mjs";

export const {
  cleanTitle,
  isElsewhere,
  cleanDescription,
} = titleCleaner({
  // DC edition. A bare "(Washington)" / "(DC)" suffix is the file saying "this
  // one is the city", so it goes; anything else in the parenthetical (a venue
  // district, a state) stays, because "(Dupont Circle)" is a neighborhood.
  citySuffix:
    /\s*[([]\s*(?:washington|w\.?d\.?c\.?|dc|district of columbia)\s*(?:,\s*(?:washington|d\.?c\.?|district of columbia))?\s*[)\]]\s*$/i,
  // Bare "(Washington)" is the city — keep it. A named other city is the
  // opposite: a listing that says "(Baltimore)" or "(Arlington)" is an event
  // someone is driving to, not one happening here, and printing it under a
  // Washington address is a lie.
  cityQualifier: new RegExp(
    "\\(\\s*(?:arlington|alexandria|baltimore|bethesda|rockville|silver\\s+spring|takoma\\s+park|college\\s+park|hyattsville|adams\\s+normal|arlington\\s+heights|falls\\s+church|fairfax|dulles|reston|herndon|mclean|vienna|sterling|annapolis|richmond|virginia|charlotte|philadelphia)\\s*\\)",
    "i"
  ),
});

export { MONTH_TOKEN, SCHEDULE_SUFFIX, TRAILING_DATE } from "./title-clean-core.mjs";