#!/usr/bin/env node
// SF Pink Pages — events scraper v2
// Pulls SF events from DoTheBay JSON + Funcheap RSS, normalizes, filters,
// dedupes, drops sold-out, links to original venue/organizer pages.
// Run: node scrape.mjs

import { writeFile } from "node:fs/promises";
import { Parser } from "xml2js";

const TZ = "America/Los_Angeles";
const DAYS_AHEAD = 3;
const OUT = "events.json";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------
function todayLA(offsetDays = 0) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(Date.now() + offsetDays * 864e5))
    .map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function laParts(iso, allDay = false) {
  if (allDay) return { date: iso.slice(0, 10), minutes: -1, timeLabel: "All day" };
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = +p.hour % 24;
  const mer = hour >= 12 ? "PM" : "AM";
  const h12 = (hour % 12) || 12;
  const timeLabel = +p.minute ? `${h12}:${String(+p.minute).padStart(2,"0")} ${mer}` : `${h12} ${mer}`;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: hour * 60 + (+p.minute || 0), timeLabel };
}

function isWithin3Days(dateStr) {
  const today = todayLA();
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const cutoff = new Date(now.getTime() + (DAYS_AHEAD + 1) * 864e5);
  // Compare LA dates
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const end = f.format(cutoff);
  return dateStr >= today && dateStr <= end;
}

// ---------------------------------------------------------------------------
// Category classifier
// ---------------------------------------------------------------------------
function categorize(title, description, category) {
  const cats = new Set();
  const text = ((title || "") + " " + (description || "")).toLowerCase();

  if (category) {
    const c = category.toLowerCase();
    if (/theatre|theater|performing arts|music|concert|film|cinema|comedy|dance|opera|ballet|choir|jazz|classical/.test(c)) cats.add("Arts & Performance");
    if (/music|concert|band|live|dj|show|gig|jam/.test(c)) cats.add("Music");
    if (/sport|fitness|wellness|yoga|run|hike|bike|workout|health|meditat|martial/.test(c)) cats.add("Fitness & Wellness");
    if (/festival|fair|market|carnival|celebrat|block party|street/.test(c)) cats.add("Festivals & Markets");
    if (/talk|workshop|panel|lecture|class|learn|training|seminar/.test(c)) cats.add("Talks & Workshops");
    if (/volunteer|civic|cleanup|community|neighborhood|clean up/.test(c)) cats.add("Volunteering & Civic");
    if (/social|meetup|networking|hangout|coffee|trivia|bingo|book club|happy hour/.test(c)) cats.add("Community & Social");
  }

  if (cats.size === 0) {
    if (/concert|band|live music|gig|dj |dance party|rave|open mic|jam session|singer|album release/.test(text)) cats.add("Music");
    if (/theatre|theater|play|musical|comedy|stand-up|standup|film|movie|screening|cinema|poetry|spoken word|gallery|exhibit|opera|ballet|dance|drag|performance|show/.test(text)) cats.add("Arts & Performance");
    if (/yoga|fitness|workout|run|running|hike|hiking|bike|cycling|meditat|mindfulness|spinning|pilates|swim|tennis|sport|athlet|martial/.test(text)) cats.add("Fitness & Wellness");
    if (/festival|fair|carnival|celebrat|block party|street fair|night market|parade|holiday/.test(text)) cats.add("Festivals & Markets");
    if (/workshop|panel|lecture|talk|class|learn|training|seminar|coaching|salon|discussion/.test(text)) cats.add("Talks & Workshops");
    if (/volunteer|civic|cleanup|clean up|neighborhood|park.?volunteer|city/.test(text)) cats.add("Volunteering & Civic");
    if (/meetup|networking|hangout|coffee|trivia|bingo|book club|happy hour|social|potluck|picnic/.test(text)) cats.add("Community & Social");
  }

  if (cats.size === 0) cats.add("Community & Social");
  return [...cats];
}

// ---------------------------------------------------------------------------
// DoTheBay — broad SF events JSON with sold_out flag, buy_url links to venue
// ---------------------------------------------------------------------------
async function fetchDoTheBay() {
  const events = [];
  let page = 1;
  let emptyStreak = 0;
  while (emptyStreak < 2 && page <= 20) {
    const url = `https://dothebay.com/events.json?page=${page}&per_page=50`;
    let res, data;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
      if (!res.ok) { console.log(`  DoTheBay page ${page}: HTTP ${res.status}`); break; }
      data = await res.json();
    } catch (e) { console.log(`  DoTheBay page ${page}: ${e.message}`); break; }

    const batch = (data.events || []).map(e => {
      const lp = laParts(e.tz_adjusted_begin_date || e.begin_time);
      if (!lp || !isWithin3Days(lp.date)) return null;
      if (e.sold_out) return null;
      if (e.past) return null;

      // Link to original venue/organizer, not DoTheBay
      const link = e.buy_url || `https://dothebay.com${e.permalink}`;

      return {
        source: "DoTheBay",
        venue: e.venue?.title || "San Francisco",
        title: e.title,
        description: (e.excerpt || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200),
        date: lp.date,
        startMinutes: lp.minutes,
        timeLabel: lp.timeLabel,
        url: link,
        free: e.is_free || false,
        categories: categorize(e.title, e.excerpt, e.category),
        alsoIn: ["DoTheBay"],
      };
    }).filter(Boolean);

    if (batch.length === 0) emptyStreak++; else emptyStreak = 0;
    events.push(...batch);
    page++;
  }
  console.log(`  DoTheBay: ${events.length} events (pages ${page-1})`);
  return events;
}

// ---------------------------------------------------------------------------
// Funcheap — RSS feed of free/cheap SF events
// ---------------------------------------------------------------------------
async function fetchFuncheap() {
  const events = [];
  try {
    const res = await fetch("https://sf.funcheap.com/feed/", {
      headers: { "User-Agent": UA, "Accept": "application/rss+xml,application/xml" }
    });
    if (!res.ok) { console.log(`  Funcheap: HTTP ${res.status}`); 

async function fetchDecentered() {
  const events = [];
  try {
    const res = await fetch("https://events.decentered.org/feeds/rss.xml", {
      headers: { "User-Agent": UA, "Accept": "application/rss+xml,application/xml" }
    });
    if (!res.ok) { console.log(`  Decentered: HTTP ${res.status}`); return events; }
    const xml = await res.text();
    const parsed = await new Parser().parseStringPromise(xml);
    const items = parsed.rss?.channel?.[0]?.item || [];

    for (const item of items) {
      const rawTitle = item.title?.[0] || "";
      const link = item.link?.[0] || "";
      const desc = (item.description?.[0] || "").replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim().slice(0, 200);
      const cats = (item.category || []).map(c => c._ || c || "").join(" ");

      // Parse date from title like "9/29/26: Event Name"
      const m = rawTitle.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[:\s—-]*\s*(.*)$/);
      if (!m) continue;
      const [, mm, dd, yy, rest] = m;
      const year = yy.length === 2 ? 2000 + +yy : +yy;
      const dateStr = `${year}-${String(+mm).padStart(2, "0")}-${String(+dd).padStart(2, "0")}`;
      if (!isWithin3Days(dateStr)) continue;

      // Strip the date prefix and trailing price tag for the display title
      const title = rest.replace(/\s*[-—]\s*(FREE|\$[\d.]+.*)$/i, "").trim() || rest.trim();

      // Parse time
      const tm = rest.match(/\b(\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm))\b/);
      let timeLabel = "All day", startMinutes = -1;
      if (tm) {
        startMinutes = parseTime(tm[1]);
        timeLabel = tm[1].toUpperCase().replace(/\\s+/g, " ");
      }

      events.push({
        source: "Decentered",
        venue: extractVenue(rest) || "San Francisco",
        title,
        description: desc,
        date: dateStr,
        startMinutes,
        timeLabel,
        url: link,
        free: /\bFREE\b/i.test(rawTitle),
        categories: categorize(title, desc, cats),
        alsoIn: ["Decentered"],
      });
    }
  } catch (e) { console.log(`  Decentered: ${e.message}`); }
  console.log(`  Decentered: ${events.length} events`);
  return events;
}

return events; }
    const xml = await res.text();
    const parsed = await new Parser().parseStringPromise(xml);
    const items = parsed.rss?.channel?.[0]?.item || [];

    for (const item of items) {
      const rawTitle = item.title?.[0] || "";
      const link = item.link?.[0] || "";
      const desc = (item.description?.[0] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      const cats = (item.category || []).map(c => c._ || c || "").join(" ");

      // Funcheap titles lead with the event date: "9/29/26: Event Name" or "11/22/26: ..."
      const m = rawTitle.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[:\s—-]*\s*(.*)$/);
      if (!m) continue;
      const [, mm, dd, yy, rest] = m;
      const year = yy.length === 2 ? 2000 + +yy : +yy;
      const dateStr = `${year}-${String(+mm).padStart(2, "0")}-${String(+dd).padStart(2, "0")}`;
      if (!isWithin3Days(dateStr)) continue;

      // Strip the date prefix and the trailing price tag for the display title
      const title = rest.replace(/\s*[-—]\s*(FREE|\$[\d.]+.*)$/i, "").trim() || rest.trim();

      // Time if the remainder carries one (e.g. "7 PM")
      const tm = rest.match(/\b(\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm))\b/);
      let timeLabel = "All day", startMinutes = -1;
      if (tm) {
        startMinutes = parseTime(tm[1]);
        timeLabel = tm[1].toUpperCase().replace(/\s+/g, " ");
      }

      events.push({
        source: "Funcheap",
        venue: extractVenue(rest) || "San Francisco",
        title,
        description: desc,
        date: dateStr,
        startMinutes,
        timeLabel,
        url: link,
        free: /\bFREE\b/i.test(rawTitle),
        categories: categorize(title, desc, cats),
        alsoIn: ["Funcheap"],
      });
    }
  } catch (e) { console.log(`  Funcheap: ${e.message}`); }
  console.log(`  Funcheap: ${events.length} events`);
  return events;
}

async function fetchValkyries() {
  const events = [];
  // 2026 Golden State Valkyries home games (from WNBA schedule)
  const games = [{"month": 5, "day": 10, "opponent": "Phoenix"}, {"month": 5, "day": 13, "opponent": "Chicago"}, {"month": 5, "day": 25, "opponent": "Connecticut"}, {"month": 5, "day": 28, "opponent": "Indiana"}, {"month": 5, "day": 31, "opponent": "Las Vegas"}, {"month": 6, "day": 2, "opponent": "Portland"}, {"month": 6, "day": 9, "opponent": "Phoenix"}, {"month": 6, "day": 15, "opponent": "Los Angeles"}, {"month": 6, "day": 17, "opponent": "Dallas"}, {"month": 6, "day": 19, "opponent": "Minnesota"}, {"month": 6, "day": 24, "opponent": "Atlanta"}, {"month": 6, "day": 26, "opponent": "Atlanta"}, {"month": 6, "day": 28, "opponent": "New York"}, {"month": 7, "day": 18, "opponent": "Washington"}, {"month": 7, "day": 20, "opponent": "Washington"}, {"month": 8, "day": 2, "opponent": "Toronto"}, {"month": 8, "day": 4, "opponent": "Toronto"}, {"month": 8, "day": 12, "opponent": "Chicago"}, {"month": 8, "day": 17, "opponent": "Dallas"}, {"month": 8, "day": 19, "opponent": "Minnesota"}, {"month": 8, "day": 24, "opponent": "Minnesota"}, {"month": 9, "day": 18, "opponent": "Portland"}, {"month": 9, "day": 19, "opponent": "Seattle"}];

  for (const game of games) {
    const dateStr = `2026-${String(game.month).padStart(2, "0")}-${String(game.day).padStart(2, "0")}`;
    // Filter: only include games within the 3-day window
    if (!isWithin3Days(dateStr)) continue;

    events.push({
      source: "WNBA",
      venue: "Chase Center",
      title: `Golden State Valkyries vs ${game.opponent}`,
      description: `WNBA regular season game: Golden State Valkyries vs ${game.opponent}`,
      date: dateStr,
      startMinutes: 1140,  // 7:00 PM
      timeLabel: "7:00 PM",
      url: "https://valkyries.wnba.com/schedule",
      free: false,
      categories: ["Sports", "Basketball"],
      alsoIn: ["WNBA"],
    });
  }
  console.log(`  Valkyries: ${events.length} events`);
  return events;
}

async function fetchDecentered() {
  const events = [];
  try {
    const res = await fetch("https://events.decentered.org/feeds/rss.xml", {
      headers: { "User-Agent": UA, "Accept": "application/rss+xml,application/xml" }
    });
    if (!res.ok) { console.log(`  Decentered: HTTP ${res.status}`); return events; }
    const xml = await res.text();
    const parsed = await new Parser().parseStringPromise(xml);
    const items = parsed.rss?.channel?.[0]?.item || [];

    for (const item of items) {
      const rawTitle = item.title?.[0] || "";
      const link = item.link?.[0] || "";
      const desc = (item.description?.[0] || "").replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim().slice(0, 200);
      const cats = (item.category || []).map(c => c._ || c || "").join(" ");

      // Funcheap titles lead with the event date: "9/29/26: Event Name"
      const m = rawTitle.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[:\s—-]*\s*(.*)$/);
      if (!m) continue;
      const [, mm, dd, yy, rest] = m;
      const year = yy.length === 2 ? 2000 + +yy : +yy;
      const dateStr = `${year}-${String(+mm).padStart(2, "0")}-${String(+dd).padStart(2, "0")}`;
      if (!isWithin3Days(dateStr)) continue;

      // Strip the date prefix and the trailing price tag for the display title
      const title = rest.replace(/\s*[-—]\s*(FREE|\$[\d.]+.*)$/i, "").trim() || rest.trim();

      // Time if the remainder carries one
      const tm = rest.match(/\b(\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm))\b/);
      let timeLabel = "All day", startMinutes = -1;
      if (tm) {
        startMinutes = parseTime(tm[1]);
        timeLabel = tm[1].toUpperCase().replace(/\\s+/g, " ");
      }

      events.push({
        source: "Decentered",
        venue: extractVenue(rest) || "San Francisco",
        title,
        description: desc,
        date: dateStr,
        startMinutes,
        timeLabel,
        url: link,
        free: /\bFREE\b/i.test(rawTitle),
        categories: categorize(title, desc, cats),
        alsoIn: ["Decentered"],
      });
    }
  } catch (e) { console.log(`  Decentered: ${e.message}`); }
  console.log(`  Decentered: ${events.length} events`);
  return events;
}





function parseTime(s) {
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return -1;
  let h = +m[1] % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + (+(m[2] || 0));
}

// Funcheap titles often carry "(SF)" or a venue in parens: "Event at The Chapel"
function extractVenue(s) {
  const m = s.match(/\(([^)]{2,40})\)/);
  if (m && !/^SF$/i.test(m[1]) && !/free|\d/i.test(m[1])) return m[1];
  return null;
}

// ---------------------------------------------------------------------------
// Dedupe by normalized title + date
// ---------------------------------------------------------------------------
function normalizeTitle(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function dedupe(events) {
  const seen = new Map();
  const result = [];
  for (const e of events) {
    const key = `${e.date}|${normalizeTitle(e.title).slice(0, 40)}`;
    if (seen.has(key)) {
      const existing = seen.get(key);
      if (!existing.alsoIn.includes(e.source)) existing.alsoIn.push(e.source);
      continue;
    }
    seen.set(key, e);
    result.push(e);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("SF Pink Pages scraper — fetching events...");
  const [dtb, fc, vk, dc] = await Promise.all([fetchDoTheBay(), fetchFuncheap(), fetchValkyries(), fetchDecentered()]);
  let all = [...dtb, ...fc, ...vk, ...dc];
  all = dedupe(all);
  all.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);

  await writeFile(OUT, JSON.stringify(all, null, 2));
  console.log(`Wrote ${all.length} events to ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });