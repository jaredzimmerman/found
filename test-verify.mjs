// The resolver is only trustworthy if it is right about the ambiguous cases.
// Each case lists what the correct venue site is, so a wrong answer is visible
// rather than silently shipped.
const NOT_A_SITE =
  /(^|\.)(yelp\.com|google\.[a-z.]+|mapquest\.com|facebook\.com|instagram\.com|twitter\.x\.com|x\.com|linkedin\.com|tripadvisor\.com|groupon\.com|nextdoor\.com|youthcentral\.com|patch\.com|sfstandard\.com|sfgate\.com|sfchronicle\.com|dothebay\.com|dostuffmedia\.com|eventbrite\.com|veezi\.com|seetickets\.[a-z.]+|ticketmaster\.[a-z.]+|axs\.com|bandsintown\.com|songkick\.com|allmusic\.com|discogs\.com|imdb\.com|rottentomatoes\.com|letterboxd\.com|justwatch\.com|monarch\.com)$/i;

function homeLike(host) {
  if (NOT_A_SITE.test(host)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  const parts = host.replace(/^www\./, "").split(".");
  return parts.length >= 2 && parts[parts.length - 2].length > 1;
}

function aboutVenue(label, host, venueName) {
  const key = venueName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const tokens = key.split(" ").filter((t) => t.length > 3);
  const hay = `${label} ${host}`.toLowerCase();
  if (!tokens.some((t) => hay.includes(t))) return false;
  return /\b(san francisco|s\.f\.|sf bay|california|cal\b|soma|hayes valley|valencia street|dogpatch|the mission|bernal heights|hayes)\b/.test(hay) ||
    /(^|\.)(sf[a-z0-9-]*\.(com|org|net)|[a-z0-9-]*sf\.(com|org|net))$/.test(host);
}

async function verifyVenueSite(url, venueName) {
  let html = "";
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    html = (await r.text()).slice(0, 12000);
  } catch { return null; }
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
                   .replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").toLowerCase();
  const key = venueName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const tokens = key.split(" ").filter((t) => t.length > 3);
  if (!tokens.some((t) => text.includes(t))) return null;
  if (!/\b(san francisco|s\.f\.|sf bay|california|cal\b)\b/.test(text)) return null;
  return url;
}

async function searx(q) {
  const r = await fetch("http://127.0.0.1:8888/search?q=" + encodeURIComponent(q) + "&format=json",
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null;
  return ((await r.json()).results || []).map((x) => ({ url: x.url, title: x.title || "" }));
}

// [venue, address, the host that is genuinely the venue — null means no
// correct site is known, so declining to answer is the right outcome]
const cases = [
  ["Monarch", "101 Sixth St.", "monarchsf.com"],
  ["Mission Bowling Club", "3176 17th Street", "missionbowlingclub.com"],
  ["SF LGBT Center", "1800 Market St", "sfcenter.org"],
  ["Gray Area", "2665 Mission Street", "grayarea.org"],
  ["Hunters Point Shipyard Artists", "Innes/Donahue", null],
  ["Artists' Television Access", "992 Valencia St.", "atasite.org"],
];

let right = 0, wrong = 0, missed = 0;
for (const [name, addr, want] of cases) {
  const q = [name, addr].filter(Boolean).join(", ") + " San Francisco";
  let results = null;
  try { results = await searx(q); } catch { /* no results */ }
  let pick = null;
  for (const r of (results || [])) {
    let u; try { u = new URL(r.url); } catch { continue; }
    const host = u.hostname.toLowerCase();
    if (!homeLike(host) || !aboutVenue(r.title, host, name)) continue;
    const v = await verifyVenueSite(`https://${host}/`, name);
    if (v) { pick = host; break; }
  }
  if (want === null) {
    if (pick) { console.log(`FALSE+ ${name.padEnd(30)} -> ${pick}  (should have found nothing)`); wrong++; }
    else { console.log(`none  ${name.padEnd(30)} (correctly declined)`); right++; }
  } else if (!pick) {
    console.log(`MISS  ${name.padEnd(30)} (expected ${want})`); missed++;
  } else if (pick.includes(want)) {
    console.log(`OK    ${name.padEnd(30)} -> ${pick}`); right++;
  } else {
    console.log(`WRONG ${name.padEnd(30)} -> ${pick}  (expected ${want})`); wrong++;
  }
}
console.log(`\nright ${right}  wrong ${wrong}  missed ${missed}`);
