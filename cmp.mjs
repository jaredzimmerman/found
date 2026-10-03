
import { cleanTitle as fromLib } from "./title-clean.mjs";
const SCHEDULE_SUFFIX =
  /[([]\s*(?:every|each|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun|weekdays?|weekends?|daily|nightly|monthly)\b[^)\]]*[)\]]/gi;
const CITY_SUFFIX = new RegExp(
  "\\s*[([]\\s*(sf|s\\.f\\.|san francisco|oakland|berkeley|daly city|santa rosa|san jose|sausalito|palo alto|marin|sonoma|walnut creek|alameda|san mateo|redwood city)\\s*[)\\]]", "i");
function localClean(title) {
  let s = String(title||"").replace(/\s+/g," ").trim();
  for (let i=0;i<4;i++){const b=s;
    s = s.replace(SCHEDULE_SUFFIX,"").replace(CITY_SUFFIX,"").trim();
    s = s.replace(/[\s,;–—|-]+$/,"").replace(/\s{2,}/g," ");}
  return s.replace(/\(\s*\)/g,"").replace(/\s{2,}/g," ").trim();
}
const cases = [
  "“Wiener Wednesday” Free Hot Dog Night at Rye (SF)",
  "FREE Comedy Night (Every Wednesday) at The Function (SF)",
  "Flight Club: Adult Flight Night for Ages 18+ at “House of Air” Trampoline Park (SF)",
  "Arcade Karaoke: SF’s Wild New Thursday Night Party + $3 Shots (SF)",
  "SF’s Noe Valley Night Market 2026",
  "Movie Party: Nacho Libre (with live trivia)",
];
for (const t of cases) {
  console.log("IN   ", t);
  console.log("  lib :", fromLib(t));
  console.log("  loc :", localClean(t));
  console.log();
}
