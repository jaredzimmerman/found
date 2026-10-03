// Probe: can a film price be read off the venue's own box-office page?
// The source publishes ticket_info="" for every film, so the price has to
// come from the venue, or it is not known. This checks whether that is
// reliably readable — if it is, the fetcher can use it; if not, "not listed"
// is the honest answer and inventing a price would be worse than a blank.
const TICKETING = /ticketing\.uswest\.veezi\.com\/purchase\/(\d+)/;

async function probe() {
  const urls = [
    "https://ticketing.uswest.veezi.com/purchase/22024?siteToken=4m48btf3yavn7xjk5yxk6nc40c",
    "https://ticketing.uswest.veezi.com/purchase/21455?siteToken=4m48btf3yavn7xjk5yxk6nc40c",
  ];
  for (const u of urls) {
    const id = u.match(TICKETING)?.[1];
    console.log("\n=== show", id, "===");
    try {
      const r = await fetch(u, {
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
        redirect: "follow",
      });
      console.log("status:", r.status, "final:", r.url.slice(0, 90));
      const html = await r.text();
      // Look for any money-shaped token anywhere in the document.
      const money = [...new Set((html.match(/\$\s?\d{1,3}(?:\.\d{2})?/g) || []))].slice(0, 12);
      console.log("money tokens found:", money.length ? money.join(" ") : "NONE");
      // And a JSON-ish price field, which Veezi often embeds.
      const json = (html.match(/"(?:price|amount|total|facevalue|face_value)"\s*:\s*"?[\d.]+"?/gi) || []).slice(0, 8);
      console.log("json price fields :", json.length ? json.join("  ") : "NONE");
      console.log("has __NEXT_DATA__ :", /__NEXT_DATA__/.test(html));
    } catch (e) {
      console.log("ERR", e.message);
    }
  }
}
probe();
