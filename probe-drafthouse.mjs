// Two different situations, tested separately:
//
//  1. Veezi box-office (Roxie, Balboa) answers 403 to any plain fetch, so a
//     price cannot be read there without a browser. Confirmed above.
//  2. Drafthouse publishes prices on its own show page. If that page is
//     readable, film prices ARE obtainable for at least one of the two major
//     SF cinemas, and the fetcher should use it rather than leaving a blank.
//
// This decides whether "movies are missing prices" is fixable or must be
// answered with a published-notice link instead.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PAGES = [
  ["Drafthouse — Deathgasm 2", "https://drafthouse.com/sf/show/deathgasm-2-goremageddon?cinemaId=0802&sessionId=20546"],
  ["Drafthouse — Terminator 2", "https://drafthouse.com/sf/show/terminator-2-judgment-day?cinemaId=0802&sessionId=20520"],
  ["Drafthouse — Nacho Libre", "https://drafthouse.com/sf/show/movie-party-nacho-libre?cinemaId=0802&sessionId=20547"],
];

async function probe() {
  for (const [label, url] of PAGES) {
    console.log(`\n=== ${label} ===`);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, redirect: "follow" });
      console.log("status:", r.status, "| final:", r.url.slice(0, 80));
      if (!r.ok) continue;
      const html = await r.text();
      console.log("bytes:", html.length);
      const money = [...new Set((html.match(/\$\s?\d{1,3}(?:\.\d{2})?/g) || []))];
      console.log("money tokens:", money.length ? money.slice(0, 15).join(" ") : "NONE");
      // Prices are often only in the embedded JSON payload.
      const embedded = (html.match(/"(?:price|amount|admission|basePrice|priceRange)"\s*:\s*"?[\d.]+"?/gi) || []).slice(0, 10);
      console.log("embedded json:", embedded.length ? embedded.join("  ") : "NONE");
      for (const kw of ["Admission", "admission", "Rush", "price"]) {
        const i = html.indexOf(kw);
        if (i !== -1) console.log(`  near "${kw}": …${html.slice(Math.max(0, i - 70), i + 130).replace(/\s+/g, " ")}…`);
      }
    } catch (e) {
      console.log("ERR", e.message);
    }
  }
}
probe();
