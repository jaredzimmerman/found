// Derive a real Washington, D.C. neighborhood for every event.
//
// Same job as hoods.mjs, different city: the feed's `neighborhood` field is not
// usable as-is (every source that populates it puts the CITY there, not the
// neighborhood), and a filter built on the city would offer one chip and filter
// nothing.
//
// D.C. is easier than San Francisco in one way that matters here: the city's
// neighborhood names are overwhelmingly derived from the streets and the civic
// districts that run through them, so a street-name or cross-street match is
// close to reliable. Where it fails, the fallback is the value already on the
// row, then the city.

import { neighborhoodEngine } from "./hoods-core.mjs";

// ZIP prefix -> neighborhood. These are the 20001–20098 prefixes, which carve
// the District into recognizable clusters. ZIP first: it is the one key that is
// stable across every source, because a street address is the only field all of
// them publish.
const ZIP_HOOD = [
  [20001, "Downtown"],
  [20002, "Downtown"],
  [20003, "Capitol Hill"],
  [20004, "Waterfront"],
  [20005, "Penn Quarter"],
  [20006, "Downtown"],
  [20007, "Penn Quarter"],
  [20008, "Dupont Circle"],
  [20009, "Georgetown"],
  [20010, "Dupont Circle"],
  [20011, "Mount Pleasant"],
  [20012, "Columbia Heights"],
  [20013, "Civic Center"],
  [20014, "Petworth"],
  [20015, "Petworth"],
  [20016, "Takoma"],
  [20017, "Anacostia"],
  [20018, "Carroll Heights"],
  [20019, "Petworth"],
  [20020, "Adams Morgan"],
  [20022, "Benning"],
  [20023, "Capitol Hill"],
  [20024, "Congress Heights"],
  [20025, "Kalorama"],
  [20026, "Shaw"],
  [20027, "Shaw"],
  [20029, "Cardozo"],
  [20030, "University Heights"],
  [20031, "Brookland"],
  [20032, "Congress Heights"],
  [20033, "Brookland"],
  [20037, "Anacostia"],
  [20038, "Waterfront"],
  [20039, "Brightwood"],
  [20040, "Mount Pleasant"],
  [20041, "Cardozo"],
  [20043, "Petworth"],
  [20044, "Anacostia"],
  [20045, "Capitol Hill"],
  [20049, "Petworth"],
  [20050, "Foggy Bottom"],
  [20052, "Foggy Bottom"],
  [20054, "Penn Quarter"],
  [20057, "Kalorama"],
  [20060, "Foggy Bottom"],
  [20062, "Brookland"],
  [20063, "Navy Yard"],
  [20064, "Woodley"],
  [20065, "Georgetown"],
  [20066, "Congress Heights"],
  [20070, "Anacostia"],
  [20071, "Anacostia"],
  [20080, "Petworth"],
  [20090, "Waterfront"],
];

/** ZIP prefix -> neighborhood. */
const byZip = new Map(ZIP_HOOD);

// Named streets that reliably name a neighborhood when no ZIP is present.
//
// Every street pattern must match BOTH the abbreviated and the spelled-out form
// ("16th St" and "16th Street" appear in the same corpus), so the suffix is
// always `(?:st|street)` rather than the bare abbreviation.
const STREET_HOOD = [
  [/\b(?:u|new)\s+st(?:reet)?\b/i, "U Street"],
  [/\bdupont\s+(?:circle|rd|road)\b/i, "Dupont Circle"],
  [/\bconn(?:ecticut)?\s+ave(?:nue)?\b/i, "Dupont Circle"],
  [/\bgeorgetown\b/i, "Georgetown"],
  [/\bwisconsin\b/i, "Georgetown"],
  [/\bcapitol\s+(?:hill|st(?:reet)?)\b/i, "Capitol Hill"],
  [/\bconstitution\s+ave(?:nue)?\b/i, "Penn Quarter"],
  [/\bnavy\s+yard\b/i, "Navy Yard"],
  [/\bvermont\s+ave(?:nue)?\b/i, "Kalorama"],
  [/\bcolumbia\s+(?:road|rd|pike|heights)\b/i, "Columbia Heights"],
  [/\bpetworth\b/i, "Petworth"],
  [/\btakoma\b/i, "Takoma"],
  [/\badams\s+morgan\b/i, "Adams Morgan"],
  [/\bfoggy\s+bottom\b/i, "Foggy Bottom"],
  [/\bans\s+?heights\b/i, "Cardozo"],
  [/\bshaw\b/i, "Shaw"],
  [/\bleesley\s+heights\b/i, "Moran Hill"],
  [/\bcardozo\b/i, "Cardozo"],
  [/\bnoma\b/i, "NoMa"],
  [/\bh\s+street\b|\bh\s+st\b/i, "H Street"],
  [/\b14th\s+(?:st(?:reet)?)\b/i, "Columbia Heights"],
  [/\b7th\s+(?:st(?:reet)?)\b/i, "Penn Quarter"],
  [/\bmount\s+pleasant\b/i, "Mount Pleasant"],
  [/\banacostia\b/i, "Anacostia"],
  [/\bcongress\s+heights\b/i, "Congress Heights"],
  [/\bbrookland\b/i, "Brookland"],
  [/\bhoneycomb\b/i, "Cardozo"],
  [/\bdwv\b/i, "Southwest"],
  [/\bwaterside\b/i, "Southwest"],
  [/\bwharf\b/i, "Waterfront"],
  [/\bbellevue\b/i, "Waterfront"],
  [/\bswann\b/i, "Dupont Circle"],
  [/\bwoodley\b/i, "Woodley"],
  [/\bsheridan\b/i, "Takoma"],
  [/\brhode island\b/i, "NoMa"],
  [/\blefant\b/i, "Anacostia"],
  [/\bcardozo (?:road|rd)\b/i, "Cardozo"],
  [/\bcalifornia (?:ave(?:nue)?|st(?:reet)?)\b/i, "Dupont Circle"],
  // "Broadway" on its own is NOT a reliable key: it recurs in the District —
  // Northwest, Takoma, Anacostia all have one — so a bare match would scatter
  // rows across whichever rule happened to be checked first. Require the NW
  // designator, and treat the rest as undecided rather than guessing.
  [/\bbroadway\b(?=[^,]{0,40}\bNW\b)/i, "Dupont Circle"],
];

// The city itself, not a neighborhood. Used to tell "undecided" from "wrong
// city" when a source names somewhere in the metro that is not the District.
const NOT_DC =
  /\b(arlington|alexandria|bethesda|rockville|potomac|md|md\.?|virginia|va|va\.?|silver\s+spring|bethesda|takoma park|adamsville|hyattsville|arlington heights|pentagon|alexandria)\b/i;

// The algorithm itself lives in hoods-core.mjs; this file is the District's tables.
const { neighborhoodFor, hoodsOf } = neighborhoodEngine({
  byZip,
  streetHood: STREET_HOOD,
  cityName: "Washington",
  cityAliases: ["washington", "washington, d.c.", "washington dc", "dc", "d.c."],
});

export { neighborhoodFor, hoodsOf };

/**
 * Is this address in the District of Columbia proper?
 *
 * Positive evidence only, and deliberately quiet on absence: a street address
 * with no city token ("3427 Connecticut Ave NW") is undecided, not excluded.
 * Several Popville records carry exactly that, and rejecting them would have
 * cost real listings. What must be rejected is the Maryland and Virginia
 * suburbs, which publish their events into the same feeds — "Bethesda", "Arling-
 * ton", "Silver Spring" all appear in DC calendars within walking distance of
 * a Metro stop and are a different city.
 */
export function inDistrict(address, city, state) {
  const c = String(city || "").trim();
  if (c) {
    if (/^washington$/i.test(c)) return true;
    return false; // a source that names a city, and it is not Washington
  }
  const s = String(state || "").trim();
  if (s && !/^(district of columbia|d\.?c\.?|dc)$/i.test(s)) return false;

  const a = String(address || "");
  const m = a.match(NOT_DC);
  // No out-of-city token: undecided, so admit it and let the EVENT's own venue
  // record decide, which is what the San Francisco pipeline does.
  return !m;
}