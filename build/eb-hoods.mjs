// ---------------------------------------------------------------------------
// eb-hoods.mjs — East Bay neighborhood tables
// Covers Berkeley, Oakland, Alameda, Piedmont, Emeryville
// ---------------------------------------------------------------------------

import { neighborhoodEngine } from "./hoods-core.mjs";

// ZIP prefix -> neighborhood for East Bay cities
const EB_ZIP_HOOD = [
  // Berkeley
  [94702, "West Berkeley"],
  [94703, "South Berkeley"],
  [94704, "Downtown Berkeley"],
  [94705, "North Berkeley"],
  [94706, "Northwest Berkeley"],
  [94707, "North Berkeley Hills"],
  [94708, "Panoramic Hill"],
  [94709, "Northside"],
  [94710, "Central Berkeley"],
  [94712, "UC Berkeley Campus"],
  [94720, "UC Berkeley Campus"],
  // Oakland
  [94601, "Fruitvale"],
  [94602, "Glenview"],
  [94603, "Elmhurst"],
  [94605, "East Oakland"],
  [94606, "West Oakland"],
  [94607, "West Oakland"],
  [94609, "Temescal"],
  [94610, "Grand Lake"],
  [94611, "Piedmont Ave / Montclair"],
  [94612, "Downtown Oakland"],
  [94613, "Downtown Oakland"],
  [94615, "Downtown Oakland"],
  [94618, "Rockridge"],
  [94619, "East Oakland"],
  [94621, "East Oakland / Airport"],
  [94662, "Emeryville"],
  // Alameda
  [94501, "Alameda"],
  [94502, "Bay Farm Island"],
];

// Named streets that reliably name a neighborhood when no ZIP is present.
// Order matters: the FIRST match wins, so the more specific patterns for a
// street that runs through several districts come before the general ones.
const EB_STREET_HOOD = [
  // Berkeley
  [/telegraph/i, "Telegraph Ave"],
  [/shattuck/i, "Downtown Berkeley"],
  [/solano/i, "North Berkeley"],
  [/claremont/i, "Claremont"],
  [/hearst/i, "Northside"],
  [/university ave/i, "Downtown Berkeley"],
  [/college ave/i, "Elmwood"],
  [/san pablo/i, "South Berkeley"],
  [/sacramento st/i, "North Berkeley"],
  [/martin luther king/i, "South Berkeley"],
  [/mlk/i, "South Berkeley"],
  // Oakland
  [/broadway/i, "Downtown Oakland"],
  [/grand ave/i, "Grand Lake"],
  [/lakeshore/i, "Grand Lake"],
  [/piedmont ave/i, "Piedmont Ave"],
  [/college ave/i, "Rockridge"],
  [/rockridge/i, "Rockridge"],
  [/temescal/i, "Temescal"],
  [/fruitvale/i, "Fruitvale"],
  [/international blvd/i, "Fruitvale"],
  [/east 14th/i, "East Oakland"],
  [/e 14th/i, "East Oakland"],
  [/west grand/i, "West Oakland"],
  [/7th st/i, "West Oakland"],
  [/webster st/i, "Downtown Oakland"],
  [/franklin st/i, "Downtown Oakland"],
  [/harrison st/i, "Adams Point"],
  [/park blvd/i, "Glenview"],
  [/macarthur/i, "Temescal"],
  [/montclair/i, "Montclair"],
  [/foothill/i, "East Oakland"],
  [/bancroft/i, "East Oakland"],
  [/seminary/i, "East Oakland"],
  [/embarcadero/i, "Jack London Square"],
  [/jack london/i, "Jack London Square"],
  // Alameda
  [/park st/i, "Alameda"],
  [/webster st/i, "Alameda"],
  [/central ave/i, "Alameda"],
  [/fernside/i, "Alameda"],
  [/bay farm/i, "Bay Farm Island"],
  // Piedmont / Emeryville
  [/piedmont/i, "Piedmont"],
  [/horton/i, "Emeryville"],
  [/powell st/i, "Emeryville"],
  [/shellmound/i, "Emeryville"],
  [/christie/i, "Emeryville"],
];

const byZip = new Map(EB_ZIP_HOOD);

const { neighborhoodFor, hoodsOf } = neighborhoodEngine({
  byZip,
  streetHood: EB_STREET_HOOD,
  cityName: "East Bay",
  cityAliases: ["oakland", "berkeley", "alameda", "piedmont", "emeryville", "east bay"],
});

export { neighborhoodFor, hoodsOf, byZip, EB_STREET_HOOD };
