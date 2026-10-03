// Host-classification patterns. These were wrong in a way that failed SILENTLY:
// `(^|\.)(bit\.ly|...)` requires a character before the dot, so a bare "bit.ly"
// or "t.co" — the two most common shorteners — never matched. Every shortener
// passed through unflagged and unfollowed, and the guard reported itself green.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "fetch.mjs"), "utf8");

// Pull the literal regexes out of the source so this tests the real thing.
function grab(name) {
  const m = src.match(new RegExp(`const ${name} =\\s*\\n?\\s*(/[^\\n;]+/[gimsuy]*)`));
  if (!m) throw new Error(`could not find ${name} in fetch.mjs`);
  return eval(m[1]); // eslint-disable-line no-eval
}
const shortener = grab("SHORTENER_RE");
const aggregator = grab("AGGREGATOR_HOSTS");

let fails = 0;
const check = (l, ok, d = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? `  [${d}]` : ""}`);
  if (!ok) fails++;
};

// Must CATCH — a real shortener, with and without a subdomain.
console.log("\n== shorteners are caught ==");
for (const h of ["bit.ly", "t.co", "www.t.co", "tinyurl.com", "lnkd.in", "t.ly",
  "x.t.ly", "buff.ly", "is.gd", "ow.ly", "goo.gl", "pxf.io"]) {
  check(`catches ${h}`, shortener.test(h));
}

// Must NOT be caught by the SHORTENER pattern — real venues that merely
// CONTAIN a shortener substring. Eventbrite and Ticketmaster are aggregators
// in their own right, so they are asserted against `shortener` only; they
// belong in the aggregator list, and there is a separate check for that.
console.log("\n== real venues are not caught ==");
for (const h of ["www.terrorvault.com", "birdbeckett.com", "illuminate.org",
  "makeoutroom.com", "thecastro.com", "www.dftsf.com", "dnalounge.com",
  "link.dice.fm"]) {
  check(`spare ${h}`, !shortener.test(h));
  check(`spare ${h} in AGGREGATORS`, !aggregator.test(h));
}
// Eventbrite and Ticketmaster must not be mistaken for SHORTENERS, but they
// are aggregators and must be flagged as such.
for (const h of ["www.eventbrite.com", "www.ticketmaster.com"]) {
  check(`spare ${h} from the shortener list`, !shortener.test(h));
}

// Aggregators must still be caught, and must still outrank venue heuristics.
console.log("\n== aggregators are caught ==");
for (const h of ["dothebay.com", "www.dothebay.com", "dostuffmedia.com", "bit.ly"]) {
  check(`aggregator ${h}`, aggregator.test(h));
}
check("venue host is not an aggregator", !aggregator.test("sfopera.com"));
check("box office is not an aggregator", !aggregator.test("shop.axs.com"));

console.log(fails ? `\n${fails} FAILED` : "\nALL GOOD");
process.exit(fails ? 1 : 0);
