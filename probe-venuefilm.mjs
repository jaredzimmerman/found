// Film prices: the source publishes ticket_info="" for every film, and the
// box-office (Veezi) answers 403 to a plain fetch. So try the venue's own
// first-party page, which is where the price is actually published and which
// the page already links to. If that is unreadable too, the honest answer is
// "not listed" — a made-up price would be worse than a blank.
const PAGES = [
  ["Roxie — Filipiñana", "https://www.roxietheater.org/event/filipinana/"],
  ["Roxie — D.E.B.S.", "https://www.roxietheater.org/event/d-e-b-s/"],
  ["Roxie events", "https://www.roxietheater.org/events/"],
];

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function probe() {
  for (const [label, url] of PAGES) {
    console.log(`\n=== ${label} ===`);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
      console.log("status:", r.status, "final:", r.url.slice(0, 80));
      if (!r.ok) continue;
      const html = await r.text();
      const money = [...new Set((html.match(/\$\s?\d{1,3}(?:\.\d{2})?/g) || []))].slice(0, 15);
      console.log("money tokens:", money.length ? money.join(" ") : "NONE");
      // Prices often sit near these words.
      for (const kw of ["Admission", "General Admission", "price", "Price", "tickets", "Rush"]) {
        const i = html.indexOf(kw);
        if (i !== -1) {
          const ctx = html.slice(Math.max(0, i - 90), i + 160).replace(/\s+/g, " ");
          console.log(`  near "${kw}": …${ctx}…`);
        }
      }
    } catch (e) {
      console.log("ERR", e.message);
    }
  }
}
probe();
