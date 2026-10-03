#!/usr/bin/env node
// ===========================================================================
//  DO NOT WIRE THIS INTO THE BUILD.  It is not safe to automate.
//
//  Resolved output over 3 identical runs: 4, then 3, then 2 venues of 8.
//  Same input, three different answers — the verdict depends on which search
//  engine answers first, so a result cannot be trusted even when it looks
//  right, and a bad one can only be caught by noticing it after publication.
//
//  Two answers were also wrong, not merely unstable:
//    * www.lowerpolkcbd.org for the First Thursday Art Walk. Lower Polk CBD
//      is the district's business association, not the organiser of the walk.
//    * artiststelevisionaccess.org, which 301s to atasite.org — technically
//      the same site, but not the canonical URL the venue publishes.
//
//  Production uses the hand-verified VERIFIED_VENUE_URLS table in fetch.mjs
//  instead. Each of those five was confirmed by fetching the page and reading
//  its title. To resolve more venues, verify them by hand the same way and add
//  them to that table. Do not import anything from this file.
//
//  Kept for the record: the address-anchored search and the branded-domain
//  check are sound ideas. The verdict pipeline that consumed them is what
//  produced wrong answers.
// ===========================================================================

// Address-anchored venue resolver.
//
// The earlier name-only resolver was measured at 1/6 correct: "Monarch" resolved
// to a Colorado casino resort and "Hunters Point" to a city planning PDF. The
// failure was ambiguity in the *name*, not in the method.
//
// The venue source publishes full_address on every record, so the query can
// carry a street number. "Gray Area 2665 Mission Street" has exactly one
// plausible answer; a name alone has thousands.
//
// Two things are required before a candidate is accepted:
//   1. the fetched page names the venue, AND
//   2. the fetched page corroborates the location — the street address, or
//      "San Francisco"/"SF" together with a city-specific token.
// A candidate that fails either is discarded even if it is the top hit. A wrong
// link is worse than an honestly-labelled listing page, so the default on
// doubt is to reject.
//
// Usage: resolve-venue.mjs            # resolve the current unlinked rows
//        resolve-venue.mjs --dry      # report only, write nothing

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// SearXNG is the search backend on this host and answers with clean JSON.
// The port is 8888 (host 127.0.0.1). Port 8080 answers with an
// OpenAI-shaped 404 from a *different* service, so a resolver pointed at
// 8080 silently returns 0 hits for every query and looks like a confident
// negative finding rather than a wiring bug. A backend that answers
// "File Not Found" is not a backend; check the response shape once.
const SEARX = "http://127.0.0.1:8888/search";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
const DRY = process.argv.includes("--dry");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function venuesIndex() {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const r = await (await fetch("https://dothebay.com/venues.json?page=" + page,
      { headers: { "User-Agent": UA } })).json();
    const v = r.venues || [];
    if (!v.length) break;
    all.push(...v);
    if (page >= (r.paging?.total_pages ?? 1)) break;
  }
  return all;
}

async function search(q) {
  const u = `${SEARX}?q=${encodeURIComponent(q)}&format=json`;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    return (await r.json()).results || [];
  } catch { return []; }
}

async function pageText(url) {
  // Retry without throwing away the final URL: a 403 from a bot wall is common
  // on small venue sites, and it must NOT be read as "this candidate is wrong"
  // — sfcenter.org 403s and that is why the LGBT Center never resolved.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "text/html,*/*", "Accept-Language": "en-US,en;q=0.9" },
        redirect: "follow", signal: AbortSignal.timeout(15000),
      });
      if (r.status === 403 || r.status === 429) return { blocked: true, finalUrl: r.url };
      if (!r.ok) continue;
      return { text: (await r.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), finalUrl: r.url };
    } catch { /* fall through to the retry */ }
  }
  return { blocked: false, text: null, finalUrl: url };
}

// The number and street name must both appear — "2665" alone is meaningless,
// and the full formatted address includes a city the source sometimes omits.
function addrTokens(full) {
  const s = (full || "").split(",")[0].trim().toLowerCase();
  const num = s.match(/^\d+/)?.[0];
  const words = s.replace(/^\d+\s*/, "").split(/\s+/).filter((w) => w.length > 3);
  return { num, words, first: words[0] };
}

// Verification. The street-address check is the only trustworthy signal: a
// page that quotes "3176 17th St" is almost certainly about that address.
//
// A bare "San Francisco" match is NOT a signal. Half the web is about San
// Francisco. It accepted gist.github.com (a raw PHP gist) and yoda.wiki (a
// Star Wars fan wiki) for the LGBT Center, and noevalleyfarmersmarket.com —
// a different organisation at a different address — for the Town Square. A
// check that passes those is not a check.
//
// So: a street address in the page body is required. "San Francisco" in the
// *title* is accepted only alongside the venue's own distinctive token in the
// title, which is far tighter than the same words anywhere on the page.
function verify(text, venueName, full, resultTitle = "", host = "", finalUrl = "") {
  // A bot wall is absence of evidence, not evidence of absence. When the page
  // cannot be read, fall back to the publisher check alone — the hostname is
  // known even when the body is not.
  const hay = (text || "").toLowerCase();
  const vkey = venueName.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const vtoks = vkey.split(/\s+/).filter((t) => t.length > 3);
  const h = String(host).toLowerCase();
  const label = h.split(".").filter((p) => p !== "www" && p !== "com" && p !== "org" && p !== "net" && !/^\d+$/.test(p))[0] || "";
  const branded = vtoks.some((t) => label.replace(/[^a-z0-9]/g, "").includes(t.replace(/[^a-z0-9]/g, "")));
  if (!branded) return { ok: false, why: `domain ${label || h} is not the venue's` };

  if (!text) return { ok: true, via: "branded domain (page unreadable)", lean: true };
  if (!vtoks.some((t) => hay.includes(t))) return { ok: false, why: "venue name absent" };

  // 1. The street address, in the page body. With a branded domain this is
  //    confirmation rather than the primary signal.
  const { num, words } = addrTokens(full);
  if (num && hay.includes(num) && words.every((w) => hay.includes(w))) {
    return { ok: true, via: `branded domain + street address` };
  }

  // 2. Otherwise both signals must appear in the *title* — a far smaller space
  //    than the body, and one a fan wiki or a code gist does not fake.
  const t = String(resultTitle || "").toLowerCase();
  const hasVenueInTitle = vtoks.some((tok) => t.includes(tok));
  const hasCityInTitle = /(san francisco|\bsf\b|soma|mission|hayes|polk|valencia|market st)/.test(t);
  if (hasVenueInTitle && hasCityInTitle) return { ok: true, via: "branded domain + venue&city in title" };

  return { ok: false, why: "branded domain, but no address or title corroboration" };
}

// A social profile is not a venue site. This list is the same one the scraper
// demotes with, and it must be checked BEFORE verification: LinkedIn verified
// "SF LGBT Center 1800 Market" purely because the street address appears in the
// page's meta tags, which says nothing about what the page is for.
const SOCIAL_HOSTS = /(^|\.)(facebook\.com|instagram\.com|twitter\.com|x\.com|threads\.net|bsky\.app|linkedin\.com|meetup\.com|youtube\.com|nextdoor\.com|tiktok\.com)$/i;

// A host that exists to hold someone's or something's listing: never the
// organizer, so never a good link target for "the venue's own page".
const DIRECTORY_HOSTS = /(^|\.)(yelp\.com|tripadvisor\.[a-z.]+|mapquest\.com|yellowpages\.[a-z.]+|foursquare\.com|google\.com|bing\.com|wikipedia\.org|wikiwand\.com|openstreetmap\.org|waze\.com|alltrails\.com|sfstation\.com|superfly\.com|soniclandscape\.com|patch\.com|sfweekly\.com|sfchronicle\.com|do512\.com|eventup\.com|explore\.california\.eater\.com)$/i;

function rejectedHost(host) {
  if (SOCIAL_HOSTS.test(host)) return "social profile";
  if (DIRECTORY_HOSTS.test(host)) return "directory";
  return null;
}

// Event/ticket middlemen are acceptable in principle (the organizer's own
// box office) but must never beat a real venue site, and LinkedIn/Eventbrite
// are both worse than nothing, so they are refused outright.
function isJunk(host) {
  return !!rejectedHost(host) || /(dothebay|dostuffmedia|universe|pxf|sfstation|sonic)/i.test(host);
}

async function main() {
  const feed = JSON.parse(readFileSync("/var/www/pinkpages.indigokarasu.com/events.json", "utf8"));
  const unlinked = feed.events.filter((e) => e.linkTier === "listing");
  const venues = await venuesIndex();
  const byName = new Map();
  for (const v of venues) if (!byName.has(v.title.trim().toLowerCase())) byName.set(v.title.trim().toLowerCase(), v);

  const resolved = {};
  for (const e of unlinked) {
    const key = e.venue.trim().toLowerCase();
    const v = byName.get(key) || byName.get(key.split("/")[0].trim());
    const addr = (v?.full_address || "").trim();
    console.log(`\n=== ${e.venue} ===`);
    if (!addr) { console.log("  no venue record -> no address anchor; skipping (no name-only guessing)"); continue; }
    console.log(`  anchor: ${addr}`);

    const queries = [
      `${e.venue} ${addr.split(",")[0]}`,
      `${e.venue} ${addr.split(",")[0]} official site`,
    ];
    let winner = null;
    for (const q of queries) {
      const results = await search(q);
      console.log(`  "${q}" -> ${results.length} hits`);
      for (const r of results.slice(0, 6)) {
        let host;
        try { host = new URL(r.url).hostname; } catch { continue; }
        if (isJunk(host)) { console.log(`    skip ${host} (aggregator/social/directory)`); continue; }
        const fetched = await pageText(r.url);
        const v2 = verify(fetched.text, e.venue, addr, r.title, host, fetched.finalUrl);
        console.log(`    ${v2.ok ? "ACCEPT" : "reject"} ${host} — ${v2.why}${v2.ok ? ` (${v2.via})` : ""} | ${String(r.title).slice(0, 48)}`);
        if (v2.ok && !winner) {
          // Follow redirects to the canonical URL: artiststelevisionaccess.org
          // 301s to www.atasite.org, and the live site is the better link.
          let finalUrl = fetched.finalUrl || r.url;
          try {
            const fh = new URL(finalUrl).hostname;
            const flabel = fh.split(".").filter((p) => p !== "www" && p !== "com" && p !== "org" && p !== "net")[0] || "";
            if (!v2.lean && flabel) {
              const vkey = e.venue.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
              const vtoks = vkey.split(/\s+/).filter((t) => t.length > 3);
              if (!vtoks.some((t) => flabel.replace(/[^a-z0-9]/g, "").includes(t.replace(/[^a-z0-9]/g, "")))) {
                console.log(`      redirect ${host} -> ${fh} (keeps venue token; adopting canonical)`);
              } else {
                finalUrl = r.url;
              }
            }
          } catch { /* keep r.url */ }
          winner = { url: finalUrl, host, via: v2.via, title: r.title, lean: !!v2.lean };
        }
        if (winner) break;
      }
      if (winner) break;
      await sleep(400);
    }
    if (winner) { resolved[e.id] = winner; console.log(`  -> RESOLVED ${winner.host}`); }
    else console.log("  -> UNRESOLVED (stays a labelled listing; a wrong link is worse)");
  }

  console.log(`\n\nresolved ${Object.keys(resolved).length} of ${unlinked.length}`);
  if (!DRY && Object.keys(resolved).length) {
    const out = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/venue-redirects.json";
    writeFileSync(out, JSON.stringify(resolved, null, 2));
    console.log("wrote", out);
  } else {
    console.log("(dry run — nothing written)");
  }
}

main();
