
const out = [];
const seen = new Set();
function categorize(a, t, d) { return ["Talks & Workshops"]; }
async function cityLights(days) {
  const VENUE = "City Lights Booksellers";
  // The browser must stay open until BOTH evaluate() calls are done. Closing it
  // in a finally around goto() — the obvious shape — leaves `page` dangling and
  // the next evaluate throws "Target page, context or browser has been closed".
  // The try/finally here wraps the whole read, not just the navigation.
  let browser = null;
  let page = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    page = await browser.newPage();
    await page.goto("https://citylights.com/events/", { waitUntil: "domcontentloaded", timeout: 45000 });

  // Read the calendar out of the rendered DOM in one pass. The page is a flat
  // sequence of "date line, time, title, blurb, type, View Details", so the
  // listing blocks are cut on the date lines and each block is then read.
  //
  // NB: the local collection is named `raw`, not `out`. The module already has
  // an `out` (the kept-events array this function pushes into), and shadowing
  // it inside the evaluate callback would read as a bug and break silently if
  // the callback were ever inlined.
  const blocks = await page.evaluate(() => {
    const DATE = /(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,?\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}),?\s*(\d{1,2}:\d{2}\s*[ap]m)\s*(?:[A-Z]{2,4})?/gi;
    const t = document.body.innerText.replace(/ /g, " ");
    const raw = [];
    const rx = new RegExp(DATE.source, "gi");
    let m;
    while ((m = rx.exec(t))) {
      const start = m.index;
      const next = t.indexOf("View Details", start);
      raw.push({
        dateText: m[1],
        time: m[2],
        text: t.slice(start, next > 0 ? next + "View Details".length : start + 600),
      });
    }
    return raw;
  });

  const anchorOrder = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/events/"]'))
      .map((a) => (a.getAttribute("href") || "").trim())
      .filter((h) => h && h !== "/events/")
      .filter((v, i, arr) => arr.indexOf(v) === i)
  );

  const MONTH = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
  let added = 0;
  for (const b of blocks) {
    const dm = b.dateText.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
    if (!dm) continue;
    const mo = MONTH[dm[1].toLowerCase()];
    if (mo == null) continue;
    const iso = `${dm[3]}-${String(mo + 1).padStart(2, "0")}-${String(dm[2]).padStart(2, "0")}`;
    if (!days.includes(iso)) continue;

    // The block text runs date line -> time -> title -> blurb -> type.
    const lines = b.text.split("\n").map((s) => s.trim()).filter(Boolean);
    const dateLine = lines[0] || "";
    const title = (lines[1] || "").replace(dateLine, "").trim() || (lines[2] || "");
    const blurb = (lines[2] || "").replace(dateLine, "").trim();
    if (!title || /^view details$/i.test(title)) continue;
    if (/event passed/i.test(dateLine)) continue;

    // Order the permalinks by the slug the listing itself names, so the right
    // URL lands on the right event rather than by position in a list.
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    let url = null;
    const exact = anchorOrder.find((h) => h === `https://citylights.com/events/${slug}/`);
    if (exact) url = exact;
    if (!url) {
      const words = title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
      const cand = anchorOrder.find((h) => words.filter((w) => h.includes(w)).length >= Math.max(1, words.length - 1));
      if (cand) url = cand;
    }
    if (!url) continue;

    const m12 = String(b.time || "").match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    const startMinutes = m12
      ? (parseInt(m12[1], 10) % 12) * 60 + parseInt(m12[2], 10) + (/pm/i.test(m12[3]) ? 720 : 0)
      : -1;
    // The block's time field can be a single time or already read as a range
    // ("7:00 pm to 9:00 pm"). Take the LAST time on the line as the end, so a
    // range survives instead of being collapsed to its first half.
    const allTimes = String(b.time || "").match(/\d{1,2}:\d{2}\s*(?:am|pm)/gi) || [];
    const endMinutes = allTimes.length > 1
      ? parseTimeToMinutes(allTimes[allTimes.length - 1])
      : -1;
    const timeLabel = startMinutes >= 0
      ? timeRangeLabel(startMinutes, endMinutes)
      : (b.time || "Time TBA");
    const cost = /\bfree\b/i.test(b.text) ? "Free" : null;

    const id = `cl-${slug}-${iso}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title,
      venue: VENUE,
      neighborhood: "North Beach",
      address: "261 Columbus Ave, San Francisco, CA 94133",
      description: blurb.slice(0, 220),
      date: iso,
      startMinutes,
      endMinutes,
      timeLabel,
      priceLabel: cost,
      // Was `cost ? "free" : "unknown"`, which is inverted: a KNOWN free
      // event was tagged "free" only by accident (cost is "Free" or null, and
      // the free row happened to exist), while a paid City Lights listing would
      // have been tagged "free". Correct: a known cost means we know the tier.
      priceTier: cost === "Free" ? "free" : (cost ? "paid" : "unknown"),
      categories: categorize(null, `${title} ${VENUE}`, blurb, VENUE),
      // City Lights' own event page IS the organiser page for a City Lights
      // event, so this is a first-party link, not an aggregator fallback.
      url,
      linkTier: "venue",
    });
    added++;
  }
  console.log(`  city lights: ${added} in-window listings (${blocks.length} on the calendar)`);
  } catch (e) {
    // One source failing must not take the whole build down. A missing browser
    // or a Cloudflare change costs City Lights' listings and nothing else.
    console.log(`  city lights: unavailable (${String(e.message).split("\n")[0]}) — skipped`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Omnivore Books on Food
//
// The second bookshop the brief named, and a different shape again from City
// Lights: a Shopify store, not a WordPress calendar. Its event list lives at
// /collections/upcoming-events and the collection page carries NO dates at
// all — each event's date is on its own product page, in an all-caps line
// ("TUESDAY, SEPTEMBER 29 AT 6:30 PM") with no year.
//
// Two consequences worth keeping:
//   * The date regex must match that exact shape. A mixed-case, year-bearing
//     pattern silently matches nothing and reports "0 events in window",
//     which is indistinguishable from a genuinely empty calendar.
//   * The year is inferred from the window rather than parsed.
//   * `omnivorebooks.com` 302s to `omnivorebooks.myshopify.com`, so the
//     myshopify host IS the canonical one. Keep it; do not "tidy" it back.
//
// A "*OFF-SITE*" listing is a real SF event that happens somewhere other than
// the shop (Reem's Mission, for one). It is kept, but filed under the venue
// named on the page instead of the shop's own address, which would otherwise
// send a reader to the wrong building.
async function omnivore(days) {
  const SHOP = "Omnivore Books on Food";
  let browser = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.goto("https://omnivorebooks.myshopify.com/collections/upcoming-events", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    const listings = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href*="/products/"]'))
        .map((a) => ({ title: a.textContent.replace(/\s+/g, " ").trim(), href: a.href }))
        .filter((x) => x.title.length > 8 && !/gift card|cookbook club/i.test(x.title))
        .filter((v, i, arr) => arr.findIndex((z) => z.href === v.href) === i)
    );

    const MONTH = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
    const year = days[0].slice(0, 4);
    let added = 0;

    for (const ev of listings) {
      let d;
      try {
        await page.goto(ev.href, { waitUntil: "domcontentloaded", timeout: 30000 });
        d = await page.evaluate(() => {
          const t = document.body.innerText.replace(/\s+/g, " ");
          // The listing prints "THURSDAY, SEPTEMBER 24 AT 7:00 PM" and, when the
          // organizer gives one, either "7:00 PM - 9:00 PM" or "7:00 PM to
          // 9:00 PM". Capturing the optional tail is what lets the row render
          // as a range instead of silently dropping the end.
          const m = t.match(
            /\b((?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),\s*(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+\d{1,2})\s+AT\s+(\d{1,2}(?::\d{2})?\s*[AP]M)(?:\s*(?:-|–|—|to|until|til)\s*(\d{1,2}(?::\d{2})?\s*[AP]M))?/i
          );
          return {
            date: m ? m[1] : null,
            time: m ? m[2] : null,
            endTime: m && m[3] ? m[3] : null,
            offSite: /off-?site/i.test(document.body.innerText),
            free: /event is free|free to attend|free event/i.test(document.body.innerText),
            venueHint: (t.match(/at (Reem'?s[^,.]*)/i) || [])[1] || null,
            blurb: (t.match(/ABOUT THE AUTHOR[\s\S]{0,300}/i) || [])[0] || "",
          };
        });
      } catch {
        continue; // one unreachable event page must not stop the walk
      }
      if (!d.date) continue;

      const dm = d.date.match(/([A-Za-z]+),?\s*(\d{1,2})$/);
      const mm = dm && MONTH[dm[1].trim().toLowerCase()];
      if (mm == null) continue;
      const iso = `${year}-${String(mm + 1).padStart(2, "0")}-${String(dm[2]).padStart(2, "0")}`;
      if (!days.includes(iso)) continue;

      const blurb = d.blurb.replace(/ABOUT THE AUTHOR\s*/i, "").slice(0, 220);
      const title = ev.title.replace(/^\*OFF-SITE\*\s*/i, "").trim();
      const offSite = /^\*OFF-SITE\*/i.test(ev.title);
      const m12 = String(d.time || "").match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
      const startMinutes = m12
        ? (parseInt(m12[1], 10) % 12) * 60 + parseInt(m12[2], 10) + (/pm/i.test(m12[3]) ? 720 : 0)
        : -1;
      // An end time on the listing becomes a range, same as every other source.
      const endMinutes = parseTimeToMinutes(d.endTime);
      const timeLabel = startMinutes >= 0
        ? timeRangeLabel(startMinutes, endMinutes)
        : (d.time || "Time TBA");
      const slug = ev.href.split("/products/")[1] || title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const id = `omni-${slug.slice(0, 40)}-${iso}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        title: CLEAN.cleanTitle(title),
        // An off-site event is not at the bookshop; do not send the reader to
        // the shop's door with a ticket for someone else's evening.
        venue: offSite && d.venueHint ? d.venueHint : SHOP,
        // Both the shop and Reem's are on Mission Street, so the neighborhood
        // is the same either way — but saying so once is honest, whereas the
        // ternary this replaced had two identical arms and read as a decision.
        neighborhood: "Mission",
        address: offSite && d.venueHint
          ? "Reem's Mission, 2801 23rd St, San Francisco, CA 94110"
          : "3198 Mission St, San Francisco, CA 94110",
        description: blurb,
        date: iso,
        startMinutes,
        endMinutes,
        timeLabel,
        priceLabel: d.free ? "Free" : null,
        priceTier: d.free ? "free" : "unknown",
        categories: categorize(null, `${title} ${SHOP}`, blurb, SHOP),
        url: ev.href,
        linkTier: "venue",
      });
      added++;
    }
    console.log(`  omnivore: ${added} in-window events (${listings.length} listed)`);
  } catch (e) {
    console.log(`  omnivore: unavailable (${String(e.message).split("\n")[0]}) — skipped`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

const days = ["2026-09-29","2026-09-30","2026-10-01"];
await cityLights(days);
console.log("\n  what it contributes:");
for (const e of out) {
  console.log(`    ${e.date}  ${e.startMinutes >= 0 ? String(Math.floor(e.startMinutes/60)).padStart(2,"0")+":"+String(e.startMinutes%60).padStart(2,"0") : "--:--"}  ${e.title}`);
  console.log(`        url:   ${e.url}`);
  console.log(`        price: ${e.priceTier}  tier: ${e.linkTier}`);
  console.log(`        blurb: ${(e.description||"").slice(0,90)}`);
}
console.log(`\n  total contributed: ${out.length}`);
