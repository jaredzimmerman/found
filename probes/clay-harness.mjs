const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
const decodeEntities=(s)=>String(s).replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ");
const registered=[];
function register(e){ registered.push(e); return true; }
async function tSafe(u){ try{const r=await fetch(u,{headers:{"User-Agent":"Mozilla/5.0"}});return await r.text();}catch{return null;} }
const parseTimeToMinutes=(l)=>{const m=/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(l||"");if(!m)return -1;let h=+m[1];if(m[3]){const p=m[3].toLowerCase();if(p==="pm"&&h<12)h+=12;if(p==="am"&&h===12)h=0;}return h*60+(+m[2]||0);};
const CLAY_SF_HOSTS = /clayroomsf\.com|clayroomsoma\.com/i;

// The studio address is published in Wix's own structured data, which is far
// more reliable than a hand-kept table of street numbers: the course pages say
// only "This class is held at our Potrero Hill Studio" with no address at all,
// while businessLocationFormatted carries the real one. Prefer that, and fall
// back to the visible address element, and only then to the studio defaults.
const CLAY_DEFAULT_ADDRESS = {
  "clayroomsf.com": "1431 17th St, San Francisco, CA 94107",
  "www.clayroomsf.com": "1431 17th St, San Francisco, CA 94107",
  "clayroomsoma.com": "727 9th St, San Francisco, CA 94103",
  "www.clayroomsoma.com": "727 9th St, San Francisco, CA 94103",
};

function clayAddress(page, url) {
  const structured =
    page.match(/"businessLocationFormatted"\s*:\s*"([^"]+)"/i)
    || page.match(/"businessLocationAddress"\s*:\s*"([^"]+)"/i);
  if (structured) {
    const a = decodeEntities(structured[1])
      .replace(/\s*,?\s*USA\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (/\d+\s+\S+\s+(st|street|ave|avenue|rd|road|drive|blvd)/i.test(a)) return a;
  }
  const visible = page.match(/<p[^>]*data-hook="location-address"[^>]*>([\s\S]{0,160}?)<\/p>/i);
  if (visible) {
    const a = decodeEntities(visible[1].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .replace(/\s*,?\s*USA\s*$/i, "")
      .trim();
    if (/\d+\s+\S+\s+(st|street|ave|avenue|rd|road|drive|blvd)/i.test(a)) return a;
  }
  const host = (url.match(/^https?:\/\/([^/]+)/i) || [])[1];
  return CLAY_DEFAULT_ADDRESS[host] || null;
}

const CLAY_DOW = "Mon|Tue|Wed|Thu|Fri|Sat|Sun";
const CLAY_MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";
const CLAY_MONTH_ABBR = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

function clayTitle(page) {
  const t = page.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
    || page.match(/<title[^>]*>([^<]+)<\/title>/i);
  return t ? t[1].replace(/\s*\|\s*clayrooms?f?\w*$/i, "").replace(/\s+/g, " ").trim() : "";
}

// The schedule is NOT in the rendered body markup — Wix keeps the page's own
// summary in <meta name="description">, which is static HTML and carries the
// schedule, the venue line and the blurb separated by blank lines. Reading the
// body instead yields one whitespace-collapsed line with no line breaks, so
// every schedule line fails the length/shape check and the source returns
// nothing. Read the meta description and fall back to the body.
function clayPageText(page) {
  const m = page.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i);
  const meta = m
    ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    : "";
  const body = decodeEntities(page)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n");
  return [meta, body].filter(Boolean).join("\n\n");
}

// A published date, normalised to {iso, label, end}.
function clayDate(day, month, timeLabel, endLabel) {
  const mi = MONTHS[(month || "").slice(0, 3).toLowerCase()];
  if (mi == null) return null;
  const d = parseInt(day, 10);
  if (!(d >= 1 && d <= 31)) return null;
  const iso = `${new Date().getFullYear()}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { iso, label: timeLabel || "Time TBA", end: endLabel || "" };
}

// A time range must carry a meridiem somewhere in the pair, otherwise the
// pattern happily matches the "24-25" inside the DATE "October 24-25" and
// reports no time at all. Scan for the first candidate that actually has one.
const CLAY_TIME = /(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)?/gi;
function clayClock(ln) {
  CLAY_TIME.lastIndex = 0;
  let m;
  while ((m = CLAY_TIME.exec(ln))) {
    // The site mixes case freely: "6-8:30PM", "6pm-8:30pm", "11AM".
    const mer = (m[2] || m[4] || "").toLowerCase();
    if (!mer) continue;
    // Both figures share one meridiem when only the second carries it:
    // "6-8:30PM" means 6pm-8:30pm, not 6am.
    return { start: `${m[1]}${mer}`, range: `${m[1]}${mer}-${m[3]}${(m[4] || mer).toLowerCase()}` };
  }
  return { start: "", range: "" };
}

// The course lines vary more than any other shape on the site. Observed:
//   "Intro to Clay Thursday @6 pm from October 15th-November 20th"
//   "Tuesdays @6-8:30PM beginning October 13th-November 17th"
//   "Mondays from 6pm-8:30pm; October 12th-November 16th"
//   "Beginning Thursday @6-8:30pm from October 14th-November 18th"
//   "Tuesday's @6-8:30PM, October 13th-November 16th"
// What all five share is the RANGE, so that is the anchor; the weekday and the
// clock time are pulled out opportunistically. Anchoring on the weekday instead
// missed four of the five.
const CLAY_RANGE = new RegExp(
  `\\b(${CLAY_MONTH})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|—|to)\\s*` +
  `(?:(${CLAY_MONTH})[a-z]*\\s+)?(\\d{1,2})(?:st|nd|rd|th)?`, "i");

// Pull schedule rows off a class page's visible text. Tolerant on purpose: the
// site mixes forms freely, so each shape gets its own rule and anything
// unrecognised is skipped rather than guessed at.
function claySchedules(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const ln = raw.replace(/\s+/g, " ").trim();
    // A schedule line states a date the way the site does: a Month D - Month D
    // range, an ampersand pair, or a weekday-anchored date that is then GIVEN A
    // CLOCK or a second weekday. "We meet on Saturday, October 3rd for the
    // "show." has the weekday and the date but neither, so it is prose.
        // Long lines are body copy however many dates they mention.
    if (!ln || ln.length > 170) continue;
    const statesDate =
      CLAY_RANGE.test(ln)
      || new RegExp(`\\b(?:${CLAY_MONTH_ABBR})[a-z]*\\s+\\d{1,2}(?:st|nd|rd|th)?\\s*&\\s*\\d{1,2}`, "i").test(ln)
      || (new RegExp(`\\b(${CLAY_DOW})[a-z]*,?\\s+(?:${CLAY_MONTH_ABBR})[a-z]*\\s+\\d{1,2}`, "i").test(ln)
          && (/\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(ln) || new RegExp(`&\\s*(${CLAY_DOW})`, "i").test(ln)));
    if (!statesDate) continue;
    const { start: startTm, range } = clayClock(ln);
    // The weekday is optional: "Beginning Thursday @6-8:30pm from ..." has one,
    // "Mondays from 6pm-8:30pm; October 12th-..." has one, and a plain
    // "October 24 & 25 with ..." has none.
    const dow = (ln.match(new RegExp(`\\b(${CLAY_DOW})`, "i")) || [])[1] || "";
    // "@6-8:30PM" also states a single start time with no range; catch that too.
    const at = (ln.match(/@\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)/i) || []);
    const clock = startTm || (at[1] ? `${at[1]}${at[2]}` : "");

    // A COURSE: a Month D - Month D range. The sessions are weekly, so they are
    // walked as real dates — stepping the day of the month would break across a
    // boundary (Oct 29 + 7 = 36).
    const rng = ln.match(CLAY_RANGE);
    if (rng) {
      const first = clayDate(rng[2], rng[1], clock || "Time TBA", "");
      const last = clayDate(rng[4], rng[3] || rng[1], "", "");
      if (first && last && last.iso >= first.iso) {
        // A range of a few days is a one-off, not a course: only walk weekly.
        const days = Math.round((new Date(`${last.iso}T12:00:00`) - new Date(`${first.iso}T12:00:00`)) / 864e5);
        if (days > 13) {
          for (let d = new Date(`${first.iso}T12:00:00`), stop = new Date(`${last.iso}T12:00:00`);
               d <= stop && out.length < 12; d.setDate(d.getDate() + 7)) {
            out.push({ iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
                       label: clock || "Time TBA", end: "" });
          }
          continue;
        }
        // Both days of a one-off share the line's clock, so carry the label
        // across the first and second pushes instead of re-deriving it.
        const oneOff = (rec) => (rec ? { ...rec, label: rec.label !== "Time TBA" ? rec.label : (clock || "Time TBA"), end: range } : rec);
        out.push(oneOff(first));
        if (last.iso !== first.iso) out.push(oneOff(last));
        continue;
      }
    }

    // "Saturday & Sunday, October 24-25 | 11am-5pm"
    let m = ln.match(new RegExp(
      `\\b(${CLAY_DOW})[a-z]*\\s*(?:&|,|and)\\s*(${CLAY_DOW})[a-z]*,?\\s+(${CLAY_MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*-\\s*(\\d{1,2})`, "i"));
    if (m) {
      const a = clayDate(m[4], m[3], startTm || "Time TBA", range);
      const b = clayDate(m[5], m[3], startTm || "Time TBA", range);
      if (a && b) { out.push(a, b); continue; }
    }

    // "Wednesday October 21st: 11am-5pm" and
    // "Saturday, November 7 & Sunday, November 8 from 10:30am - 2:30pm"
    m = ln.match(new RegExp(
      `\\b(${CLAY_DOW})[a-z]*,?\\s+(${CLAY_MONTH_ABBR})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?` +
      `(?:\\s*(?:,|&|and|-|–|from)\\s*(?:(${CLAY_DOW})[a-z]*,?\\s+)?(${CLAY_MONTH_ABBR})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?)?` +
      `(?:\\s*(?::|from)\\s*(\\d{1,2}:\\d{2}\\s*(?:am|pm)))?`, "i"));
    if (m) {
      const a = clayDate(m[3], m[2], startTm || m[7] || "Time TBA", range);
      if (a) {
        out.push(a);
        if (m[4] && m[6]) {
          const b = clayDate(m[6], m[5], startTm || m[7] || "Time TBA", range);
          if (b) out.push(b);
        }
        continue;
      }
    }

    // Bare "October 24 & 25 with Justin Paik-Reese" / "Oct 21 & 22"
    m = ln.match(new RegExp(`\\b(${CLAY_MONTH_ABBR})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*&\\s*(\\d{1,2})`, "i"));
    if (m) {
      const a = clayDate(m[2], m[1], "Time TBA", range);
      const b = clayDate(m[3], m[1], "Time TBA", range);
      if (a && b) { out.push(a, b); continue; }
    }
  }
  // A class page states the same schedule twice — once in the meta description
  // and once in the body — so a naive parse emitted every session twice and the
  // 3-day window filled with duplicate rows. Collapse on the date, preferring
  // whichever copy carries a clock: the two passes can differ there ("11am"
  // from the meta, "Time TBA" from the body) and emitting both is still a dup.
  const byDate = new Map();
  for (const r of out) {
    const prev = byDate.get(r.iso);
    if (!prev) { byDate.set(r.iso, r); continue; }
    if (prev.label === "Time TBA" && r.label !== "Time TBA") byDate.set(r.iso, r);
  }
  return [...byDate.values()].sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
}

async function clayroom(days) {
  const VENUE = "Clayroom SF";
  const html = await tSafe("https://www.clayroomsf.com/workshop");
  if (!html) return console.log("  clayroom: page unavailable — skipped");

  // Class links from the index. Wix appends ?referral=... / ?category=... to
  // each; drop the query so the published url is the clean class page.
  const hrefs = new Set();
  for (const m of html.matchAll(/href="(https?:\/\/[^"]*\/service-page\/[^"]+)"/g)) hrefs.add(m[1].split("?")[0]);
  // The Potrero Hill page carries this studio's own 6-week courses, whose cards
  // have no dates but whose class pages do.
  const ph = await tSafe("https://www.clayroomsf.com/potrero-hill-classes");
  if (ph) for (const m of ph.matchAll(/href="(https?:\/\/[^"]*\/service-page\/[^"]+)"/g)) hrefs.add(m[1].split("?")[0]);

  if (!hrefs.size) {
    return console.log(
      "  clayroom: no class links on the index — the site layout changed, so this source contributed nothing");
  }

  const year = days[0].slice(0, 4);
  const seen = new Set();
  let added = 0, nonSF = 0, noDate = 0;

  for (const url of hrefs) {
    if (seen.has(url)) continue;
    seen.add(url);
    // Non-SF studios share the index; skip them without spending a fetch.
    if (!CLAY_SF_HOSTS.test(url)) { nonSF++; continue; }

    const page = await tSafe(url);
    if (!page) continue;

    const bodyText = clayPageText(page);
    const scheds = claySchedules(bodyText);
    if (!scheds.length) { noDate++; continue; }

    const address = clayAddress(page, url);

    const title = clayTitle(page) || "Clayroom class";
    for (const s of scheds) {
      if (s.iso.slice(0, 4) !== year || !days.includes(s.iso)) continue;
      const kept = register({
        id: `clay-${url.split("/").pop()}-${s.iso}`,
        title,
        venue: VENUE,
        neighborhood: "San Francisco",
        address,
        description: "",
        date: s.iso,
        startMinutes: parseTimeToMinutes(s.label),
        timeLabel: s.label,
        priceLabel: null,
        priceTier: "unknown",
        categories: ["Talks & Workshops"],
        url,
        linkTier: "venue",
      });
      if (kept) added++;
    }
  }
  console.log(
    `  clayroom: ${added} in-window events (${seen.size} class pages, ` +
    `${nonSF} non-SF skipped, ${noDate} with no parsable date)`);
}


const days=["2026-10-12","2026-10-13","2026-10-14"];
await clayroom(days);
const byDate={};
for(const e of registered) (byDate[e.date] ||= []).push(e);
for(const d of Object.keys(byDate).sort()){
  console.log(`\n  ${d}  (${byDate[d].length})`);
  for(const e of byDate[d]) console.log(`    ${String(e.startMinutes).padStart(5)}  ${e.timeLabel.padEnd(8)} ${e.title.slice(0,38).padEnd(40)} ${e.address||'NO ADDRESS'}`);
}
console.log(`\n  rows: ${registered.length}  unique ids: ${new Set(registered.map(e=>e.id)).size}`);
console.log(`  missing address: ${registered.filter(e=>!e.address).length}`);
