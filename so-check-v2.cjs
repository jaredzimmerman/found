// Sold-out detection is the one filter that must never be wrong in the
// expensive direction: a false "sold out" silently hides a show someone could
// have gone to. These cases are drawn from real descriptions, including the two
// that were wrongly removed.
const SOLD_OUT_RE =
  /\b(sold[\s‐-]?out|sell(?:ed)?[\s‐-]?out|out of stock|no (?:more )?(?:tickets|seats) (?:available|remaining)|at capacity|fully booked)\b/i;

function soldOut(e, raw = "") {
  if (e.sold_out === true || e.sold_out === "true") return true;
  if (e.soldOut === true || e.soldOut === "true") return true;
  const m = String(raw || "").match(SOLD_OUT_RE);
  if (!m) return false;

  const raw2 = String(raw || "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const hit2 = SOLD_OUT_RE.exec(raw2);
  if (!hit2) return false;
  const at = hit2.index;

  const start = Math.max(
    raw2.lastIndexOf(".", at - 1) + 1,
    raw2.lastIndexOf("!", at - 1) + 1,
    raw2.lastIndexOf("?", at - 1) + 1,
    raw2.lastIndexOf("\n", at - 1) + 1,
    0);
  let end = raw2.length;
  for (const ch of [".", "!", "?", "\n"]) {
    const i = raw2.indexOf(ch, at);
    if (i !== -1) end = Math.min(end, i);
  }
  const sentence = raw2.slice(start, end).trim();
  const hay = sentence.toLowerCase();

  if (/\b(this|these)\s+(show|gig|event|performance|concert|one|tickets?)\b/.test(hay)) return true;
  if (/\b(tickets?|seats?|admission)\b[^.!?]{0,30}\b(are|is|were|has|have|had)\b/.test(hay)) return true;
  if (hay.length < 40) return true;

  if (/\b(prev|previous|last|prior|past|formerly|once|earlier|since|through|co-?headline|back-?catalogue|catalogue|tour|tours|nationwide|national|history|previously|record[- ]breaking|landmark|record[- ]set|album|discography)\b/.test(hay)) return false;
  if (/\b(19|20)\d{2}\b/.test(hay)) return false;

  return true;
}

const FREE = [
  ["JPEGMAFIA real copy", "This run follows his very successful co-headline tour alongside Danny Brown for their collaborative album “SCARING THE HOES!” which included sold-out shows nationwide including landmark venues like The Hollywood Palladium. The album debuted at number 84 on the Billboard 200."],
  ["Steve Earle real copy", "Hardly Strictly Bluegrass presents An Evening Honoring Steve Earle Featuring Buddy Miller, Elizabeth Cook, Emmylou Harris. Last year’s festival sold out in a single day."],
  ["A previous performance", "A previous performance sold out in minutes."],
  ["Last year's tour", "Last year's tour included sold-out dates across the country."],
  ["Previously sold out", "The band previously sold out the Fillmore three times."],
  ["2019 run", "Their 2019 run of sold-out dates broke records."],
  ["Album history", "Their second album sold out in every market it reached."],
];
const SOLD = [
  ["bare banner", "SOLD OUT."],
  ["this event is", "This event is sold out."],
  ["tickets are", "Tickets are sold out."],
  ["em dash", "Sold out — join the waitlist."],
  ["sorry this show", "Sorry, this show is sold out."],
  ["this performance", "This performance has sold out."],
  ["admission", "Admission is sold out."],
  ["no tickets remain", "This event has sold out and no tickets remain."],
  ["with markup", "<p>Doors at 7. <b>Sold out.</b></p><p>Waitlist only.</p>"],
];

let bad = 0;
console.log("--- must be FALSE: available, copy mentions a past sold-out run ---");
for (const [name, t] of FREE) {
  const r = soldOut({}, t);
  if (r) bad++;
  console.log(`  ${r ? "FAIL" : "OK  "}  ${name}`);
}
console.log("--- must be TRUE: a real status statement ---");
for (const [name, t] of SOLD) {
  const r = soldOut({}, t);
  if (!r) bad++;
  console.log(`  ${r ? "OK  " : "FAIL"}  ${name}`);
}
console.log(`\n${bad} failing of ${FREE.length + SOLD.length}`);
