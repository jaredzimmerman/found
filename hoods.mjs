// Derive a real San Francisco neighborhood for every event.
//
// The feed's `neighborhood` field is nearly useless: 106 of 110 rows read
// "San Francisco", which is the city, not the neighborhood. A filter built on it
// would offer one chip and filter nothing. 109 of 110 rows do carry a full
// street address with a ZIP, and ZIP prefix -> neighborhood is the one mapping
// in SF that is stable enough to key on (the city has 30-odd named
// neighborhoods but only a handful of coherent ZIP clusters).
//
// A street name is a good second signal where there is no ZIP: "Fulton and
// Larkin" and "24th St. & Sanchez St" are intersections, and the cross street
// usually names the neighborhood. ZIP first, street-name cross street second,
// and "SF" as the honest fallback.

import { neighborhoodEngine } from "./hoods-core.mjs";

const ZIP_HOOD = [
  // 94102 — Financial District / South Beach / Rincon Hill
  [94102, "Financial District"],
  [94103, "SoMa"],
  [94104, "SoMa"],
  [94105, "SoMa"],
  [94107, "SoMa"],
  [94108, "North Beach"],
  [94110, "Mission"],
  [94111, "Mission"],
  [94112, "Mission"],
  [94114, "Bernal Heights"],
  [94115, "Western Addition"],
  [94116, "Noe Valley"],
  [94117, "Haight-Ashbury"],
  [94118, "Inner Sunset"],
  [94119, "Outer Sunset"],
  [94120, "Potrero Hill"],
  [94121, "Potrero Hill"],
  [94122, "Outer Sunset"],
  [94123, "Marina"],
  [94124, "Mission"],
  [94131, "Bernal Heights"],
  [94132, "Bayview"],
  [94133, "North Beach"],
  [94107, "SoMa"],
  [94158, "Mission Bay"],
  [94103, "SoMa"],
  [94109, "Nob Hill"],
  [94112, "Mission"],
  [94102, "Financial District"],
  [94121, "Potrero Hill"],
  [94125, "Noe Valley"],
  [94129, "Presidio"],
  [94134, "Bayview"],
  [94137, "Bayview"],
  [94118, "Inner Sunset"],
];

/** ZIP prefix -> neighborhood. */
const byZip = new Map(ZIP_HOOD);

// Named streets that reliably name a neighborhood when no ZIP is present.
//
// Every street pattern must match BOTH the abbreviated and the spelled-out
// form. The feed mixes them freely — "3117 16th Street" and "24th St. & Sanchez
// St" appear in the same corpus — so a pattern written only as `\b16th\s+st\b`
// silently misses "16th Street" and the row falls through to the generic
// "San Francisco". That is how the first pass left the Flower Mart row
// unresolved: the abbreviation-only pattern did not match the spelled form.
// `(?:st|street)` and friends, case-insensitive, throughout.
const STREET_HOOD = [
  [/\bhaight\b/i, "Haight-Ashbury"],
  [/\bcastro\b/i, "Castro"],
  [/\bmission\b(?!.*bay)/i, "Mission"],
  [/\bvalencia\b/i, "Mission"],
  [/\bguerrero\b/i, "Mission"],
  [/\bhayes\b/i, "Hayes Valley"],
  [/\bpolk\b/i, "Russian Hill"],
  [/\bfilbert\b/i, "North Beach"],
  [/\bcolumbus\b/i, "North Beach"],
  [/\bgrant\b(?!.*park)/i, "North Beach"],
  [/\bdivisadero\b/i, "NoPa"],
  [/\bsanchez\b/i, "Noe Valley"],
  [/\b16th\s+(?:st|street)\b/i, "Inner Sunset"],
  [/\b24th\s+(?:st|street)\b/i, "Mission"],
  [/\b(?:van\s+ness|vanness)\b/i, "Civic Center"],
  [/\bgeary\b/i, "Richmond"],
  [/\bclement\b/i, "Richmond"],
  [/\bjudah\b/i, "Outer Sunset"],
  [/\bgreat\s+highway\b/i, "Outer Sunset"],
  [/\bunion\b/i, "Cow Hollow"],
  [/\bfolsom\b/i, "SoMa"],
  [/\bharrison\b/i, "SoMa"],
  [/\bembarcadero\b/i, "Financial District"],
  [/\bmarket\s+st(?:reet)?\b/i, "Downtown"],
  [/\bpost\s+st(?:reet)?\b/i, "Union Square"],
  [/\bsutter\b/i, "Union Square"],
  [/\bbernal\b/i, "Bernal Heights"],
  [/\b3rd\s+st(?:reet)?\b/i, "Mission"],
  [/\bpotrero\b/i, "Potrero Hill"],
  [/\bmarina\b/i, "Marina"],
  [/\bvan\b.*\bness\b/i, "Civic Center"],
  [/\bpresidio\b/i, "Presidio"],
  [/\bnob\b/i, "Nob Hill"],
];

/**
 * Best-effort neighborhood for one event.
 * @param {string} address  street address, may be an intersection
 * @param {string} fallback the value already on the row
 *
 * The algorithm lives in hoods-core.mjs; this file is San Francisco's tables.
 */
const { neighborhoodFor, hoodsOf } = neighborhoodEngine({
  byZip,
  streetHood: STREET_HOOD,
  cityName: "San Francisco",
  cityAliases: ["san francisco", "sf"],
});

export { neighborhoodFor, hoodsOf };
