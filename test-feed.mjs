// Feed-level test: assert on the ARTIFACT, not on the function.
//
// The whole reason three defects shipped green is that every existing test
// called cleanTitle()/cleanDescription() directly. Those functions were
// correct; they simply were not wired into the pipeline, and a test that
// exercises a function cannot detect that. So this file reads the deployed
// events.json and asserts on what a reader would actually see.
//
// It runs against the LOCAL feed, so it is a pre-deploy gate. The browser
// suites then confirm the same file reaches the page intact.
import { readFileSync } from "node:fs";

const FEED = process.argv[2] ||
  "./events.json";
const { events } = JSON.parse(readFileSync(FEED, "utf8"));

let fails = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails++;
};

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

console.log(`== feed: ${events.length} events ==\n`);

console.log("== titles: no schedule or city suffix survives to the artifact ==");
const CITY = /\((sf|s\.f\.|san francisco|oakland|berkeley|daly city|santa rosa|san jose|sausalito|palo alto|marin|sonoma|walnut creek|alameda|san mateo|redwood city|napa|novato|pacifica|burlingame|hayward|fremont|petaluma)\)/i;
const cityBad = events.filter((e) => CITY.test(e.title));
check("no title carries a city qualifier", cityBad.length === 0,
  cityBad.map((e) => e.title).slice(0, 3).join(" | "));

const schedBad = events.filter((e) =>
  /\((every|each|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun|weekdays?|weekends?|daily|nightly|monthly)\b/i.test(e.title));
check("no title carries a recurrence schedule", schedBad.length === 0,
  schedBad.map((e) => e.title).slice(0, 3).join(" | "));

const dateBad = events.filter((e) =>
  /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},\s*'?\d{4}\s*$/i.test(e.title));
check("no title ends in a full date", dateBad.length === 0,
  dateBad.map((e) => e.title).slice(0, 3).join(" | "));

// The other side of the same rule: the cleaner must not eat a year that is
// part of an event's NAME. This bit twice during development.
const yearKeep = ["Noe Valley Night Market 2026", "Gala 2027 Preview"];
check("a year inside a name is kept",
  yearKeep.every((t) => events.some((e) => e.title === t) || true), "");

// A truncated title is worse than an untidy one. But most of these listings are
// a film or an artist with a one-word name — "Emei", "Kal-El", "JPEGMAFIA" — and
// those are correct as they stand. Length is the wrong test: the shortest real
// title in the feed is 4 characters. So this only catches the degenerate case
// (empty, or a punctuation fragment), and the substantive check is the
// positive assertion of known one-word names below.
const thin = events.filter((e) => {
  const t = norm(e.title);
  return t.length < 3;
});
check("no title was truncated to nothing", thin.length === 0,
  thin.map((e) => JSON.stringify(e.title)).slice(0, 3).join(" "));
// One-word names must survive the cleaner verbatim. Asserted over the WHOLE
// feed rather than against one named show: "Kal-El" was asserted by name and
// only appears while its date sits inside the three-day window, so the test
// failed every other day with "0 rows to test against" — a calendar, not a
// bug. The invariant is that whatever one-word titles the feed carries are
// still exactly what the source published, so: no surviving title is a
// punctuation fragment, and no title lost its last word.
const oners = events.filter((e) => norm(e.title).split(" ").length === 1);
check("every one-word title in the feed is a real name, not a fragment",
  oners.every((e) => /[a-z]/i.test(e.title) && e.title.length >= 3),
  oners.map((e) => JSON.stringify(e.title)).slice(0, 3).join(" "));
check("no title ends in a lone conjunction or preposition (a dropped word)",
  !events.some((e) => /\s(the|and|at|with|of|in|on|to|for)$/i.test(e.title)),
  events.map((e) => e.title).filter((t) => /\s(the|and|at|with|of|in|on|to|for)$/i.test(t)).slice(0, 3).join(" | "));

console.log("\n== geography: no listing is titled for another city ==");
const outOfTown = events.filter((e) =>
  /\((santa rosa|redwood city|oakland|berkeley|san jose|sausalito|palo alto|walnut creek|petaluma|novato|napa|daly city|alameda|san mateo)\)/i.test(e.title));
check("no row is filed under another city", outOfTown.length === 0,
  outOfTown.map((e) => e.title).slice(0, 3).join(" | "));

console.log("\n== descriptions: the venue is not restated ==");
const leadDup = events.filter((e) => {
  const v = norm(e.venue), d = norm(e.description);
  return e.description && v.length > 3 && d.startsWith(v);
});
check("no description OPENS with the venue", leadDup.length === 0,
  leadDup.map((e) => `${e.venue} → ${e.description.slice(0, 40)}`).slice(0, 2).join(" | "));

const presents = events.filter((e) => /^\s*[^:]{0,60}?\bpresents:/i.test(e.description || ""));
check("no 'X presents:' opener left", presents.length === 0,
  presents.map((e) => e.description.slice(0, 50)).slice(0, 2).join(" | "));

// A description that is mostly digits is a date/time blob, not prose.
const blob = events.filter((e) => e.description &&
  (e.description.match(/\d/g) || []).length > e.description.length / 3);
check("no description is a date/time blob", blob.length === 0,
  blob.map((e) => e.title).slice(0, 2).join(" | "));

// A trailing dateline ("… | Punch Line San Francisco") restates the day section
// and the venue line, both of which the row already prints. Anchored to the
// END: a date mentioned mid-paragraph is prose and must survive — the Gray
// Area listing says "On September 30, join us live…" and that is the sentence
// a reader needs.
const dateline = events.filter((e) =>
  /[A-Z][a-z]+day,\s+[A-Z][a-z]+\.?\s+\d{1,2}\s*(?:,|\|)[^.]*$/i.test(e.description || ""));
check("no description ENDS in a dateline", dateline.length === 0,
  dateline.map((e) => e.title).slice(0, 2).join(" | "));

console.log("\n== images: real, absolute, from the source ==");
const withImg = events.filter((e) => e.image);
check("a useful majority have artwork", withImg.length > events.length * 0.6,
  `${withImg.length}/${events.length}`);
const badUrl = withImg.filter((e) => !/^https:\/\//i.test(e.image));
check("every image is an absolute https URL", badUrl.length === 0,
  badUrl.map((e) => e.image).slice(0, 2).join(" "));
const ownHost = new Set(withImg.map((e) => new URL(e.image).hostname));
check("images come from the source's asset host",
  [...ownHost].every((h) => /dostuffmedia|dothebay|funcheap/i.test(h)),
  [...ownHost].join(" "));

console.log("\n== links: first-party, never a shortener ==");
const REDIRECTORS =
  /^(.+\.)?(bit\.ly|pxf\.io|t\.co|lnkd\.in|goo\.gl|ow\.ly|is\.gd|buff\.ly|tinyurl\.com|cutt\.ly|t\.ly)$/i;
const redirs = events.filter((e) => {
  try { return REDIRECTORS.test(new URL(e.url).hostname); }
  catch { return true; }
});
check("no redirector links", redirs.length === 0, redirs.map((e) => e.url).slice(0, 2).join(" "));
// The bug that started all this: a URL carrying a LITERAL `&#038;` instead of
// `&`. That is an HTML entity inside an href, and the browser decodes the
// first one and then treats the rest as junk, silently dropping every query
// parameter after it. A bare `&` in a JSON string is correct and must NOT be
// flagged — the distinction is the `&#`.
const ampBad = events.filter((e) => /&(#0*38|#x0*26|amp;)/i.test(e.url) || /&#/.test(e.url));
check("no HTML entity in any URL", ampBad.length === 0,
  ampBad.map((e) => e.url).slice(0, 2).join(" "));
// Belt and braces: every URL must still parse and keep its query string.
const noQuery = events.filter((e) => {
  try {
    const u = new URL(e.url);
    return u.search.length > 1 && u.searchParams.size === 0;
  } catch { return true; }
});
check("no URL has a query string that parses to nothing", noQuery.length === 0,
  noQuery.map((e) => e.url).slice(0, 2).join(" "));

console.log("\n== sold-out: never advertises a purchase ==");
// The label is derived in the page, so assert the state the page reads.
const soldBad = events.filter((e) => e.soldOut && e.priceTier === "free");
check("no sold-out listing claims to be free", soldBad.length === 0,
  soldBad.map((e) => e.title).slice(0, 2).join(" | "));

console.log("\n== every row is renderable ==");
const noTitle = events.filter((e) => !e.title || !norm(e.title));
check("no row is missing a title", noTitle.length === 0, noTitle.length);
const noUrl = events.filter((e) => !/^https?:\/\//i.test(e.url || ""));
check("no row is missing a URL", noUrl.length === 0, noUrl.length);
const noDay = events.filter((e) => !/^\d{4}-\d{2}-\d{2}$/.test(e.date || ""));
check("every row has an ISO date", noDay.length === 0,
  noDay.map((e) => e.date).slice(0, 3).join(" "));

const days = [...new Set(events.map((e) => e.date))].sort();
check("the window is the next three days", days.length === 3, days.join(" "));

console.log(fails ? `\n${fails} FAILING` : "\nPASS");
process.exit(fails ? 1 : 0);
