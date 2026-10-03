#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Resolve real admission prices for listings the feed can only call "Ticketed".
//
// The upstream feed publishes no amount for 40 of the listings: `ticket_info`
// is an empty string and `is_free` is simply false. So the price has to come
// from the box office itself, in a real browser, because the hosts that have
// one either render it client-side or sit behind a bot wall.
//
// The hard part is not fetching. It is NOT STEALING SOMEONE ELSE'S PRICE.
// The Roxie copy for "Black Swan" reads: "…or stay for Perfect Blue at 8:50 PM
// with a special $24 double-feature ticket." That $24 belongs to a DIFFERENT
// ticket — the pairing — and printing it as Black Swan's price would be a lie
// on a page whose whole claim is that it links you to the real thing. Every
// price below is therefore accepted only if it survives an admission-price
// guard, and the result is cached so the nightly run does not re-fetch.
//
// Output: prices.json — { "<eventId>": {label, source} } — merged by fetch.mjs.
// ---------------------------------------------------------------------------
// ESM will not resolve a bare directory specifier, and the package is
// CommonJS, so neither `import { chromium } from "…/playwright"` nor the
// explicit index.js path works: the first fails to resolve, the second fails
// on the named export. The default-export interop is the one form that does.
import playwright from "/usr/local/lib/hermes-agent/node_modules/playwright/index.js";
const { chromium } = playwright;
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const CACHE = new URL("./prices.json", import.meta.url);
const OUT = new URL("./prices-resolved.json", import.meta.url);
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

// Text near a money token that proves the number is NOT this event's ticket.
const FOREIGN = /double[-\s]?(feature|bill|program|programme|billing)|pairing|screening of|followed by|or stay for|see \w+ at \d|with .{0,40} at \d{1,2}:\d{2}\s*pm/i;
// Text that proves the number is admission for a ticket.
const ADMIT = /ticket|admission|general|door|rush|reception|cover|pass|seating|balcony|floor|loge|mezzanine|reserved|GA\b|sliding scale|pay what/i;
// Money that is plainly not admission: subscriptions, fees, delivery, tips.
const NOT_ADMIT = /month|\/mo\b|subscription|membership|shipping|delivery|fee|donat|tip|gratuity|late fee|processing|per \w+ (order|month)/i;

function score(tok, ctx) {
  if (FOREIGN.test(ctx)) return null;          // belongs to another ticket
  if (NOT_ADMIT.test(ctx)) return null;        // not admission at all
  if (!ADMIT.test(ctx)) return null;           // no admission signal
  return { label: tok.replace(/\s+/g, ""), ctx: ctx.replace(/\s+/g, " ").trim().slice(0, 90) };
}

const feed = JSON.parse(readFileSync(new URL("./events.json", import.meta.url), "utf8")).events;
const targets = feed.filter((e) => e.priceTier === "ticketed");
console.log(`ticketed listings: ${targets.length}`);

// One representative URL per host first, so we learn which hosts are worth
// visiting at all before spending a browser page-load on 40 of them.
const probe = (u) => u;

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const resolved = {};
  const walls = [];
  const dead = [];

  for (const e of targets) {
    const key = String(e.id);
    // A negative result must be re-tried, not cached. An earlier version stored
    // `null` for a host that had not finished rendering yet, and the cache
    // check `if (cache[key])` treated that as a hit — so a price that became
    // readable on a later run was never looked for again, and the listing was
    // permanently stuck at "Ticketed". Only a positive price short-circuits.
    if (cache[key] && cache[key].label) { resolved[key] = cache[key]; continue; }

    let r;
    try {
      await page.goto(e.url, { waitUntil: "domcontentloaded", timeout: 40000 });
      await page.waitForTimeout(3200);
      r = await page.evaluate(() => {
        const t = document.body.innerText;
        return {
          money: [...new Set(t.match(/\$\s?\d+(?:\.\d{2})?(?:\s?[-–]\s?\$\s?\d+(?:\.\d{2})?)?/g) || [])],
          wall: /just a moment|security verification|are you a robot|access denied|checking your browser|enable javascript and cookies/i.test(t),
          // Only a REAL 404, and only from the title or the top of the body.
          // Scoping matters: the previous version matched `/404/` against
          // 12,000 characters of text, so any listing that merely mentioned
          // the number — a seat number, a price band, a year — was reported
          // dead. That mislabelled 25 healthy links as broken.
          notfound: /(?:^|\s)(?:error\s*)?404(?:\s|$)|page not found|not found\b|no longer available/i.test(
            document.title + " " + t.slice(0, 300)
          ),
          // The full text, not a prefix. A box office states its prices in
          // the seat map, hundreds of characters down — a 1600-char window
          // found 1 of the prices that a probe with no cap had already seen.
          head: t.slice(0, 12000),
        };
      });
    } catch (err) {
      r = { money: [], wall: false, notfound: true, head: "", err: err.message.slice(0, 70) };
    }

    if (r.notfound) { dead.push({ id: key, title: e.title, url: e.url }); continue; }
    if (r.wall) { walls.push(new URL(e.url).hostname); continue; }

    // Score every money token against its own surrounding context.
    const found = [];
    for (const tok of r.money) {
      const at = r.head.indexOf(tok);
      if (at < 0) continue;
      const ctx = r.head.slice(Math.max(0, at - 130), at + 70);
      const s = score(tok, ctx);
      if (s) found.push(s);
    }
    if (found.length) {
      resolved[key] = { label: found[0].label, via: new URL(e.url).hostname, at: new Date().toISOString() };
      console.log(`  ok   ${e.title.slice(0, 34).padEnd(36)} ${resolved[key].label}`);
    }
  }

  writeFileSync(CACHE, JSON.stringify({ ...cache, ...resolved }, null, 1));
  writeFileSync(OUT, JSON.stringify({ resolved, dead, walls: [...new Set(walls)] }, null, 1));
  await browser.close();

  console.log(`\nresolved with a guarded price: ${Object.keys(resolved).length} / ${targets.length}`);
  console.log(`behind a bot wall: ${[...new Set(walls)].join(", ") || "none"}`);
  console.log(`dead box-office links: ${dead.length}`);
  for (const d of dead) console.log(`   DEAD  ${d.title.slice(0, 40).padEnd(42)} ${d.url.slice(0, 62)}`);
})();
