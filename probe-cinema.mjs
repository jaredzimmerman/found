const VENUES = [
  ["Roxie Theater", "https://www.roxietheater.com/showtimes/"],
  ["Alamo Drafthouse", "https://drafthouse.com/program/san-francisco"],
  ["Grand North", "https://www.grandnorth.moe/films/"],
  ["Balboa Theater", "https://balboatheatre.com/"],
  ["Koret", "https://www.koret.org/"],
  ["Tenderloin", "https://www.cinematenderloin.com/films"],
  ["Sundance Kabuki", "https://www.sundancecinemas.com/kabuki/"],
];

const money = /\$(\s?\d{1,3}(?:\.\d{2})?)/g;
const clean = (s) => s.replace(/\s+/g, " ").trim();

for (const [name, url] of VENUES) {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      },
      signal: AbortSignal.timeout(20000),
    });
    const html = await res.text();
    const prices = [...new Set([...html.matchAll(money)].map((m) => m[1].replace(/\s/g, "")))];
    console.log(`\n=== ${name} -> ${res.status}, ${html.length} bytes`);
    console.log("   prices found:", prices.length ? prices.join(" ") : "(none)");
    // Show a title + its nearby price to see the pairing shape.
    for (const m of [...html.matchAll(money)].slice(0, 3)) {
      const s = Math.max(0, m.index - 160);
      console.log("   ctx:", clean(html.slice(s, m.index + 30)).slice(0, 150));
    }
  } catch (e) {
    console.log(`\n=== ${name} -> ${e.name}: ${e.message}`);
  }
}
