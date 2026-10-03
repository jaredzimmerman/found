// ---------------------------------------------------------------------------
// Titles and descriptions — San Francisco
// ---------------------------------------------------------------------------
// Kept in its own module so the fetcher and its tests exercise the SAME
// functions. An earlier test re-declared the cleaners inline, so a green test
// could sit next to a broken fetcher and prove nothing.
//
// The rules live in title-clean-core.mjs; this file is San Francisco's
// place-name lists. Keep it to those two regexes and an export.

import { titleCleaner } from "./title-clean-core.mjs";

export const {
  cleanTitle,
  isElsewhere,
  cleanDescription,
} = titleCleaner({
  // A trailing city suffix is the file saying "this one is the city" — drop it.
  // A NAMED OTHER city is the opposite: KQED lists "Rick Steves: How to See the
  // World (Santa Rosa)" from its SF headquarters, and printing it at 2601
  // Mariposa Street is the opposite of the truth.
  citySuffix:
    /\s*[([]\s*(?:sf|s\.f\.|san\s+francisco|oakland|berkeley|daly\s+city|santa\s+rosa|san\s+jose|sausalito|palo\s+alto|marin|sonoma|walnut\s+creek|alameda|san\s+mateo|redwood\s+city|napa|san\s+rafael|novato|pacifica|burlingame|south\s+san\s+francisco|daly|hayward|union\s+city|fremont|millbrae|san\s+bruno|el\s+cerrito|richmond|walnut|antioch|concord|livermore|pleasanton|pinole|hercules|vallejo|petaluma)\s*[)\]]\s*$/i,
  // Same list minus SF's own spellings: a bare "(SF)" is the city, not a place
  // elsewhere, so isElsewhere() must not fire on it.
  cityQualifier: new RegExp(
    "\\(\\s*(?:oakland|berkeley|daly\\s+city|santa\\s+rosa|san\\s+jose|sausalito|palo\\s+alto|marin|sonoma|walnut\\s+creek|alameda|san\\s+mateo|redwood\\s+city|napa|san\\s+rafael|novato|pacifica|burlingame|south\\s+san\\s+francisco|daly|hayward|union\\s+city|fremont|millbrae|san\\s+bruno|el\\s+cerrito|richmond|antioch|concord|livermore|pleasanton|vallejo|petaluma)\\s*\\)",
    "i"
  ),
});

export { MONTH_TOKEN, SCHEDULE_SUFFIX, TRAILING_DATE } from "./title-clean-core.mjs";