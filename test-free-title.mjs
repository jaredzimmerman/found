// Free-in-the-title -> free tier.
//
// THE BUG: 6 live rows had "free" in the title and only 1 was tagged free. The
// 5 that were not are venue-calendar listings (Asian Art Museum, Japanese Tea
// Garden, Yoga Garden SF, Emporium SF, Manny's) which arrive with no
// description and no `is_free` field, so priceOf() had nothing to read and fell
// through to `unknown` — while the page showed a title saying "Free Admission".
//
// WHY THE FIX IS NOT A ONE-LINE /\bfree\b/ ON THE TITLE: two of the five are
// not free events at all.
//   "Manny's Neighborhood Trash Cleanup" w/ $1 Beer & Free Yoga  -> has a price
//   "Emporium SF 8 Free Game Tokens"                              -> not admission
// A naive title scan tags both "free" and tells the reader a $1-beer event costs
// nothing. So the rule has to distinguish "free to ATTEND" from "free SOMETHING
// ELSE", and those two cases are exactly where it fails.
//
// Everything here is asserted against the real 6 live rows plus the false
// positives, so the suite fails if the rule ever widens past what was measured.

import { readFileSync } from "node:fs";

// The file is modified by an external writer since the last full read (the
// earlier restore in the negative-test step), so the price rules are re-read
// fresh here rather than trusted from memory.
const priceRules = (() => {
  const s = readFileSync(new URL("./fetch.mjs", import.meta.url), "utf8");
  const start = s.indexOf("function priceOf(");
  if (start < 0) throw new Error("priceOf() not found in fetch.mjs");
  let depth = 0, bodyStarted = false;
  for (let j = start; j < s.length; j++) {
    if (s[j] === "{") { depth++; bodyStarted = true; }
    else if (s[j] === "}") { depth--; if (bodyStarted && depth === 0) return s.slice(start, j + 1); }
  }
  throw new Error("could not extract priceOf() — braces unbalanced");
})();

// priceOf is pure, so it can be exercised WITHOUT importing fetch.mjs. Importing
// it runs main() — a full scrape of every source — which is why this suite used
// to print a whole build's log and take a minute. It also means a failing pricing
// assertion was buried under scraper output. Extracting the function keeps the
// test fast and the failure legible.
//
// The dependency is the REAL FREE_WORDS, lifted out of fetch.mjs by value. It was
// a hand-written copy in the first draft of this file, and it was a FUNCTION where
// the code calls .test() on it — so the suite died with "FREE_WORDS.test is not a
// function" instead of testing anything. The lesson generalises: a test that
// reimplements the thing it is testing is testing its own copy.
const FREE_WORDS_SRC = (() => {
  const s = readFileSync(new URL("./fetch.mjs", import.meta.url), "utf8");
  const m = s.match(/^const FREE_WORDS\s*=\s*(\/.*\/[a-z]*);/m);
  if (!m) throw new Error("FREE_WORDS not found in fetch.mjs — extraction is stale");
  return m[0];
})();

// freeFromTitle is extracted from fetch.mjs the same way, and is the rule the
// Funcheap reader calls directly. If this extraction goes stale the suite fails
// loudly rather than silently testing a hand-copied regex.
const freeFromTitleSrc = (() => {
  const s = readFileSync(new URL("./fetch.mjs", import.meta.url), "utf8");
  const start = s.indexOf("function freeFromTitle(");
  if (start < 0) throw new Error("freeFromTitle() not found in fetch.mjs — the shared rule was renamed or removed");
  let depth = 0, bodyStarted = false;
  for (let j = start; j < s.length; j++) {
    if (s[j] === "{") { depth++; bodyStarted = true; }
    else if (s[j] === "}") { depth--; if (bodyStarted && depth === 0) return s.slice(start, j + 1); }
  }
  throw new Error("could not extract freeFromTitle() — braces unbalanced");
})();

const priceOf = new Function(
  "strip", "admissionPrice", "PRICE_OVERRIDES",
  // freeFromTitle is included here rather than stubbed. It is the shared rule
  // the Funcheap reader calls too, and stubbing it here would let the aggregator
  // half of the test pass while the Funcheap half — where the actual live bug
  // was — was never exercised.
  `${FREE_WORDS_SRC}\n${freeFromTitleSrc}\n${priceRules}; return priceOf;`
)(
  (s) => String(s || "").replace(/\s+/g, " ").trim(),
  () => null,
  {}
);

const ROWS = [
  // --- the 5 that were wrong: title says free, no other signal ---
  { title: "Asian Art Museum: Free Admission Day", is_free: undefined, excerpt: "", description: "" },
  { title: "Free Monthly Yoga Class for Beginners | SF", is_free: undefined, excerpt: "", description: "" },
  { title: "Japanese Tea Garden's Free Admission Hour (Golden Gate Park)", is_free: undefined, excerpt: "", description: "" },
  // --- the 2 that MUST NOT become free ---
  { title: "“Manny’s Neighborhood Trash Cleanup” w/ $1 Beer & Free Yoga Classes, Free", is_free: undefined, excerpt: "", description: "" },
  { title: "SF Arcade Bar “Emporium” 8 Free Game Tokens for “Industry Night”", is_free: undefined, excerpt: "", description: "" },
  // --- controls: already working, must not regress ---
  // MAPP carries `is_free: true` from the source, so it was ALWAYS tagged free.
  // It is a control, not a case the new rule needs to catch — if the rule broke
  // it, the source flag would have to be ignored. Asserting "unchanged" here
  // (the previous draft did) fails against correct behaviour.
  { title: "“MAPP” SF’s Free Art, Poetry & Concert Crawl", is_free: true, expect: "free", why: "source asserts is_free" },
  { title: "Ticketed Show", is_free: false, excerpt: "", description: "" },
  { title: "A $22 Concert", is_free: false, excerpt: "", description: "" },
  { title: "Gala Dinner", is_free: undefined, excerpt: "", description: "" },
];

let fail = 0;
const check = (name, cond, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fail++;
};

console.log("\nfree-in-title tagging\n");

for (const r of ROWS) {
  const { label, tier } = priceOf(r);
  const hasPrice = /\$/.test(r.title) || /\$/.test(r.excerpt || "") || /\$/.test(r.description || "");
  // The title asserts free-to-attend only when "free" modifies ADMISSION or the
  // class itself. "Free Yoga Classes" and "8 Free Game Tokens" modify something
  // else entirely, and are covered by their own rows below.
  const wantsFree =
    /\bfree\b/i.test(r.title) &&
    /\b(free\s+(admission|entry|monthly|class|classes|to\s+attend|tickets?)|no\s+cover|complimentary)\b/i.test(r.title);

  // An explicit `expect` on the row wins over the derived one — that is how a
  // control states what it is actually asserting.
  let expect = r.expect;
  if (!expect) {
    if (hasPrice) expect = "not free";
    else if (wantsFree) expect = "free";
    else expect = "leave alone";
  }

  if (expect === "free") {
    check(`"${r.title.slice(0, 44)}" -> free${r.why ? " (" + r.why + ")" : ""}`,
      tier === "free" && label === "Free", `got tier=${tier} label=${JSON.stringify(label)}`);
  } else if (expect === "not free") {
    check(`"${r.title.slice(0, 44)}" -> NOT free`,
      tier !== "free", `got tier=${tier} (has a price / "free" modifies something else)`);
  } else if (/\bfree\b/i.test(r.title)) {
    // A title containing "free" that is neither priced nor admission-related must
    // NOT be promoted — this is the over-tagging half of the rule.
    check(`"${r.title.slice(0, 44)}" -> unchanged despite "free"`,
      tier !== "free", `got tier=${tier}`);
  } else {
    check(`"${r.title.slice(0, 44)}" -> unchanged`,
      tier !== "free", `got tier=${tier}`);
  }
}

// --- negative control: the gate must be able to fail ------------------------
// A rule that always returns "free" would pass the two "NOT free" rows only if
// the test were wrong. Prove the discriminator is load-bearing by feeding it a
// title that reads free-admission but carries an explicit price.
const trap = priceOf({
  title: "Free Admission Day — $25 special ticket",
  is_free: undefined,
  excerpt: "",
  description: "",
});
check("NEG: an explicit $ beats a free-admission title",
  trap.tier !== "free", `got tier=${trap.tier}`);

// And the reverse: strip the price and it must flip to free. If it does not, the
// price is winning for the wrong reason and the rule is untested.
const flip = priceOf({
  title: "Free Admission Day",
  is_free: undefined,
  excerpt: "",
  description: "",
});
check("NEG: same title without a price DOES become free",
  flip.tier === "free", `got tier=${flip.tier}`);

// The is_free:false + free-admission-title case is a JUDGEMENT call the code
// currently resolves as "free". Pin it so a later edit has to make a deliberate
// choice instead of inheriting whatever the branch order happened to produce.
// The venue field is weaker evidence here than the title: is_free is false on
// every ticketed listing including ones whose copy never states a price, so it
// cannot distinguish "paid" from "we did not read a price".
const contested = priceOf({
  title: "Free Admission Day",
  is_free: false,
  excerpt: "",
  description: "",
});
check("is_free:false + free-admission title -> free (title wins over the tri-state flag)",
  contested.tier === "free", `got tier=${contested.tier}`);

// But a REAL price in the same row still wins — that is the bound that matters,
// because it is the one that would ship a wrong number.
const contestedPriced = priceOf({
  title: "Free Admission Day",
  is_free: false,
  ticket_info: "$25",
  excerpt: "",
  description: "",
});
check("is_free:false + free-admission title + $25 -> paid (the $ still wins)",
  contestedPriced.tier === "paid" && contestedPriced.label === "$25",
  `got tier=${contestedPriced.tier} label=${JSON.stringify(contestedPriced.label)}`);

// ---- the Funcheap path, which is where the live bug actually was -------------
// All six affected rows are Funcheap (ids fc-*), and funcheap() does NOT call
// priceOf() — it reads its own <span class="cost"> markup. The first version of
// this fix landed only in priceOf(), passed every assertion in this suite, and
// changed NOTHING on the page.
//
// THE FIRST DRAFT OF THIS BLOCK REBUILT THE CALL SITE IN THE TEST:
//
//     const cost = null;
//     const got = cost ? /\bfree\b/i.test(cost) : freeFromTitle(t);
//
// That is the test testing its own copy. Deleting `freeFromTitle(title)` from
// funcheap() in fetch.mjs left this block passing — verified by negative test —
// because the regex it exercised was the one written HERE, not the one shipped.
// So this block now asserts on the SOURCE TEXT of the call site: that funcheap()
// really routes its fallback through the shared rule. A structural claim needs a
// structural check.
console.log("\nfuncheap path (no <span class=\"cost\"> present)\n");

const FC = [
  { t: "Asian Art Museum: Free Admission Day", free: true },
  { t: "Japanese Tea Garden's Free Admission Hour (Golden Gate Park)", free: true },
  { t: "Free Monthly Yoga Class for Beginners | SF", free: true },
  { t: "“Manny’s Neighborhood Trash Cleanup” w/ $1 Beer & Free Yoga Classes, Free", free: false },
  { t: "SF Arcade Bar “Emporium” 8 Free Game Tokens for “Industry Night”", free: false },
  { t: "SF Standup Comedy Showcase at The Comedy Store", free: false },
];
const freeFromTitle = new Function(`${freeFromTitleSrc}; return freeFromTitle;`)();
for (const { t, free: want } of FC) {
  // Mirrors funcheap(): cost is null, so the title is the only signal.
  const cost = null;
  const got = cost ? /\bfree\b/i.test(cost) : freeFromTitle(t);
  check(`freeFromTitle: "${t.slice(0, 42)}" -> ${want ? "free" : "not free"}`, got === want, `got ${got}`);
}

// The structural assertion: read the shipped funcheap() body and require that
// its `free` computation falls back to freeFromTitle(). Negative-tested —
// removing the call turns this red.
const fetchSrc = readFileSync(new URL("./fetch.mjs", import.meta.url), "utf8");
const fcStart = fetchSrc.indexOf("async function funcheap(");
check("funcheap() exists in fetch.mjs", fcStart > 0);
const fcBody = fcStart > 0 ? fetchSrc.slice(fcStart, fcStart + 40000) : "";
// Stop at the next top-level source function so a match further down the file
// cannot satisfy this check by accident.
const fcEnd = fcBody.search(/\n\}\n\n\/\/ ---|\nasync function |\nfunction /);
const fcScope = fcEnd > 0 ? fcBody.slice(0, fcEnd) : fcBody;

const fcFreeLine = (fcScope.match(/const free = [^;]+;/) || [])[0] || "";
check("NEG: funcheap() routes its no-cost fallback through freeFromTitle()",
  /freeFromTitle\s*\(\s*title\s*\)/.test(fcFreeLine),
  fcFreeLine ? `found: ${fcFreeLine.trim().slice(0, 80)}` : "no `const free = ...` line found in funcheap()");
check("NEG: funcheap() does not hardcode `: false` for the fallback",
  !/:\s*false\s*;?\s*$/.test(fcFreeLine),
  fcFreeLine ? `found: ${fcFreeLine.trim().slice(0, 80)}` : "n/a");

console.log(fail === 0 ? "\nPASS" : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);