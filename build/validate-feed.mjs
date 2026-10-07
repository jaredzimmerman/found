// Feed validator (plan contracts C3, C4, C5, C2). No dependencies; node 18+.
//
//   node build/validate-feed.mjs --events F [--report R] [--floors P] [--history H]
//        [--live-url U] [--accept-delta] [--out O] [--accept-file A] [--today YYYY-MM-DD]
//
// Exit 0 = ok (warnings printed), 1 = fatal. Writes build/.validate-report.json
// {ok, fatal[], warnings[], stats}. The module also exports validateFeed(feed, ctx),
// which is pure: it does no I/O and never mutates its inputs.
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const LINK_TIERS = ["venue", "boxoffice", "listing", "aggregator"];
export const DELTA_LOW = 0.6;
export const DELTA_HIGH = 1.6;
export const MAX_LISTED = 40; // problems listed per message class before "... and N more"

// ---------------------------------------------------------------------------
// Taxonomy: single source of truth is build/fetch.mjs. fetch.mjs runs main() on
// import, so it must never be imported; its source text is read instead.
// Allowed = the CATEGORIES list + every MAP value + every KEYWORDS category.
// ---------------------------------------------------------------------------
export function taxonomyFromSource(src) {
  const set = new Set();
  const list = /const CATEGORIES\s*=\s*\[([\s\S]*?)\];/.exec(src);
  if (!list) throw new Error("validate-feed: cannot find `const CATEGORIES = [` in fetch.mjs");
  for (const m of list[1].matchAll(/"([^"\n]+)"/g)) set.add(m[1]);
  const map = /const MAP\s*=\s*\{([\s\S]*?)\n\};/.exec(src);
  if (map) for (const m of map[1].matchAll(/:\s*"([^"\n]+)"\s*,?/g)) set.add(m[1]);
  const kw = /const KEYWORDS\s*=\s*\[([\s\S]*?)\n\];/.exec(src);
  if (kw) for (const m of kw[1].matchAll(/\/,\s*"([^"\n]+)"\s*\]/g)) set.add(m[1]);
  // Literal fallbacks inside categorize(), e.g. `|| "Community"` / `["Community"]`.
  const fn = /function categorize\(([\s\S]*?)\n\}\n/.exec(src);
  if (fn) for (const m of fn[1].matchAll(/(?:\|\||\?\?|\[)\s*"([A-Z][A-Za-z &]+)"/g)) set.add(m[1]);
  if (set.size < 5) throw new Error("validate-feed: taxonomy extraction found too few categories");
  return [...set];
}
export function loadTaxonomy(fetchPath = path.join(HERE, "fetch.mjs")) {
  return taxonomyFromSource(fs.readFileSync(fetchPath, "utf8"));
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
export function pacificToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}
const isDate = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const nonEmptyStr = (v) => typeof v === "string" && v.trim() !== "";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const kind = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

export function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ---------------------------------------------------------------------------
// validateFeed(feed, ctx) -> {ok, fatal[], warnings[], stats}
// ctx: {
//   categories: string[]        allowed taxonomy (required; see loadTaxonomy)
//   today?: "YYYY-MM-DD"        Pacific date; default computed from the clock
//   floors?: {name:{min,required}}
//   report?: C2 source report   {sources:{name:{status,kept,...}}}
//   history?: C5 records[]      oldest first
//   liveTotal?: number          live feed total, used when < 3 published runs
//   acceptDelta?: boolean       downgrade a delta fatal to a warning
//   acceptFileExists?: boolean  same, from the one-shot file (CLI consumes it)
// }
// stats.deltaDowngraded is true when acceptDelta/acceptFile actually downgraded a fatal.
// ---------------------------------------------------------------------------
export function validateFeed(feed, ctx = {}) {
  if (!Array.isArray(ctx.categories) || !ctx.categories.length) {
    throw new TypeError("validateFeed: ctx.categories (allowed taxonomy) is required");
  }
  const allowed = new Set(ctx.categories);
  const fatal = [];
  const warnings = [];
  const stats = {};
  const today = ctx.today || pacificToday();

  if (!isObj(feed)) {
    fatal.push("feed: not a JSON object");
    return { ok: false, fatal, warnings, stats };
  }

  // (b) envelope
  const days = feed.days;
  if (!Array.isArray(days)) fatal.push(`feed.days: expected an array of 3 dates, got ${kind(days)}`);
  else {
    if (days.length !== 3) fatal.push(`feed.days: expected 3 entries, got ${days.length}`);
    for (const d of days) if (!isDate(d)) fatal.push(`feed.days: ${JSON.stringify(d)} is not a YYYY-MM-DD date`);
    if (!days.includes(today)) fatal.push(`feed.days: does not include today (${today}); days=${JSON.stringify(days)}`);
  }
  if (!Array.isArray(feed.events)) {
    fatal.push(`feed.events: expected an array, got ${kind(feed.events)}`);
    return { ok: false, fatal, warnings, stats };
  }
  const events = feed.events;
  const total = events.length;
  stats.total = total;
  stats.today = today;
  if (total === 0) fatal.push("feed.events: empty");
  if (feed.generatedAt !== undefined && !(typeof feed.generatedAt === "string" && !Number.isNaN(Date.parse(feed.generatedAt)))) {
    warnings.push(`feed.generatedAt: ${JSON.stringify(feed.generatedAt)} is not an ISO timestamp`);
  }

  // (a) per-event schema
  const dayset = new Set(Array.isArray(days) ? days : []);
  const seenIds = new Map();
  const problems = []; // [id, field, message]
  const bad = new Set();
  const add = (id, field, msg) => { problems.push([id, field, msg]); bad.add(id); };
  events.forEach((e, i) => {
    const idLabel = isObj(e) && nonEmptyStr(e.id) ? e.id : `#${i}`;
    if (!isObj(e)) return add(idLabel, "(event)", `expected an object, got ${kind(e)}`);
    if (!nonEmptyStr(e.id)) add(idLabel, "id", `expected a non-empty string, got ${JSON.stringify(e.id)}`);
    else if (seenIds.has(e.id)) add(e.id, "id", `duplicate id (also at index ${seenIds.get(e.id)})`);
    else seenIds.set(e.id, i);
    if (!nonEmptyStr(e.title)) add(idLabel, "title", `expected a non-empty string, got ${JSON.stringify(e.title)}`);
    if (!isDate(e.date)) add(idLabel, "date", `${JSON.stringify(e.date)} is not a YYYY-MM-DD date`);
    else if (dayset.size && !dayset.has(e.date)) add(idLabel, "date", `${e.date} is not in feed.days`);
    for (const k of ["startMinutes", "endMinutes"]) {
      // -1 is the real "unknown" sentinel in published feeds (endMinutes especially).
      if (!Number.isInteger(e[k]) || e[k] < -1) add(idLabel, k, `expected an integer >= -1, got ${JSON.stringify(e[k])}`);
    }
    if (typeof e.timeLabel !== "string") add(idLabel, "timeLabel", `expected a string, got ${kind(e.timeLabel)}`);
    for (const k of ["venue", "address"]) {
      if (e[k] !== null && typeof e[k] !== "string") add(idLabel, k, `expected string or null, got ${kind(e[k])}`);
    }
    if (!Array.isArray(e.categories)) {
      add(idLabel, "categories", `expected a non-empty array of strings, got ${kind(e.categories)} ${JSON.stringify(e.categories)}`);
    } else if (!e.categories.length) {
      add(idLabel, "categories", "empty array");
    } else {
      for (const c of e.categories) {
        if (typeof c !== "string") add(idLabel, "categories", `non-string entry ${JSON.stringify(c)}`);
        else if (!allowed.has(c)) add(idLabel, "categories", `unknown category ${JSON.stringify(c)}`);
      }
    }
    if (typeof e.url !== "string" || !/^https?:\/\/\S+$/i.test(e.url)) add(idLabel, "url", `expected an http(s) URL string, got ${JSON.stringify(e.url)}`);
    if (!LINK_TIERS.includes(e.linkTier)) add(idLabel, "linkTier", `${JSON.stringify(e.linkTier)} not in ${LINK_TIERS.join("|")}`);
    if (typeof e.priceTier !== "string") add(idLabel, "priceTier", `expected a string, got ${kind(e.priceTier)}`);
    if (Object.prototype.hasOwnProperty.call(e, "source")) add(idLabel, "source", "internal `source` key must be stripped before publishing");
  });
  stats.badEvents = bad.size;
  for (const [id, field, msg] of problems.slice(0, MAX_LISTED)) fatal.push(`event ${id}: ${field}: ${msg}`);
  if (problems.length > MAX_LISTED) {
    fatal.push(`... and ${problems.length - MAX_LISTED} more event problems (${bad.size} events affected in total)`);
  }

  // (c) floors
  const floors = isObj(ctx.floors) ? ctx.floors : {};
  const srcs = isObj(ctx.report) && isObj(ctx.report.sources) ? ctx.report.sources : null;
  const byLower = new Map();
  if (srcs) for (const [n, v] of Object.entries(srcs)) byLower.set(n.toLowerCase(), { name: n, v });
  stats.sources = {};
  if (srcs) for (const { name, v } of byLower.values()) stats.sources[name] = Number.isFinite(v?.kept) ? v.kept : 0;
  for (const [fname, spec] of Object.entries(floors)) {
    if (!isObj(spec) || !Number.isFinite(spec.min)) { warnings.push(`floors: entry ${fname} is malformed`); continue; }
    const hit = byLower.get(fname.toLowerCase());
    if (!srcs) { warnings.push(`floors: no source report supplied; cannot check floor for ${fname}`); continue; }
    if (!hit) { warnings.push(`floors: ${fname} has no entry in the source report`); continue; }
    const kept = Number.isFinite(hit.v?.kept) ? hit.v.kept : 0;
    if (kept < spec.min) {
      const why = hit.v?.status && hit.v.status !== "ok" ? ` (status ${hit.v.status}${hit.v.reason ? ": " + hit.v.reason : ""})` : "";
      const msg = `source ${fname}: kept ${kept}, below its floor of ${spec.min}${why}`;
      (spec.required ? fatal : warnings).push(spec.required ? msg : msg + " [optional]");
    }
  }

  // (d) delta guard
  const published = (Array.isArray(ctx.history) ? ctx.history : [])
    .filter((r) => isObj(r) && r.outcome === "published" && Number.isFinite(r.total));
  let baseline = null;
  let baselineSrc = null;
  if (published.length >= 3) {
    const last = published.slice(-7);
    baseline = median(last.map((r) => r.total));
    baselineSrc = `median of the last ${last.length} published runs`;
  } else if (Number.isFinite(ctx.liveTotal)) {
    baseline = ctx.liveTotal;
    baselineSrc = `live feed total (only ${published.length} published run(s) in history)`;
  } else {
    warnings.push(`delta: no baseline (only ${published.length} published run(s) in history and no live total); delta guard skipped`);
  }
  stats.baseline = baseline;
  stats.deltaDowngraded = false;
  if (baseline && baseline > 0) {
    const ratio = total / baseline;
    stats.deltaRatio = Math.round(ratio * 1000) / 1000;
    const accept = !!(ctx.acceptDelta || ctx.acceptFileExists);
    if (total < baseline * DELTA_LOW) {
      const msg = `delta: ${total} events is ${Math.round(ratio * 100)}% of ${baseline} (${baselineSrc}); below the ${DELTA_LOW * 100}% limit`;
      if (accept) { warnings.push(msg + " [accepted]"); stats.deltaDowngraded = true; }
      else fatal.push(msg);
    } else if (total > baseline * DELTA_HIGH) {
      warnings.push(`delta: ${total} events is ${Math.round(ratio * 100)}% of ${baseline} (${baselineSrc}); above ${DELTA_HIGH * 100}% (warning only)`);
    }
  }

  return { ok: fatal.length === 0, fatal, warnings, stats };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

export function readHistory(p) {
  const out = [];
  let text;
  try { text = fs.readFileSync(p, "utf8"); } catch { return out; }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line must not break the build */ }
  }
  return out;
}

function fetchTotal(url, redirects = 3) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { return resolve(undefined); }
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.get(u, { timeout: 20000, headers: { "User-Agent": "whattodo72-validate/1" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetchTotal(new URL(res.headers.location, u).href, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(undefined); }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(Array.isArray(j.events) ? j.events.length : undefined);
        } catch { resolve(undefined); }
      });
      res.on("error", () => resolve(undefined));
    });
    req.on("timeout", () => { req.destroy(); resolve(undefined); });
    req.on("error", () => resolve(undefined));
  });
}

export async function main(argv) {
  const a = { acceptDelta: false };
  const valued = new Set(["events", "report", "floors", "history", "live-url", "out", "accept-file", "today", "fetch-src"]);
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    if (!m) { console.error(`validate-feed: unexpected argument ${argv[i]}`); return 2; }
    if (m[1] === "accept-delta") a.acceptDelta = true;
    else if (valued.has(m[1])) {
      if (i + 1 >= argv.length) { console.error(`validate-feed: --${m[1]} needs a value`); return 2; }
      a[m[1]] = argv[++i];
    } else { console.error(`validate-feed: unknown flag --${m[1]}`); return 2; }
  }
  if (!a.events) { console.error("validate-feed: --events is required"); return 2; }
  const outPath = a.out || path.join(HERE, ".validate-report.json");
  const acceptFile = a["accept-file"] || path.join(HERE, ".accept-delta");

  const finish = (res) => {
    try { fs.writeFileSync(outPath, JSON.stringify(res, null, 2) + "\n"); }
    catch (e) { console.error(`validate-feed: could not write ${outPath}: ${e.message}`); }
    for (const w of res.warnings) console.log(`WARN  ${w}`);
    for (const f of res.fatal) console.log(`FATAL ${f}`);
    console.log(res.ok
      ? `validate-feed: OK (${res.stats.total} events, ${res.warnings.length} warning(s))`
      : `validate-feed: REJECTED (${res.fatal.length} fatal, ${res.warnings.length} warning(s))`);
    return res.ok ? 0 : 1;
  };

  let feed;
  try { feed = readJson(a.events); }
  catch (e) { return finish({ ok: false, fatal: [`events file ${a.events}: ${e.message}`], warnings: [], stats: {} }); }

  let categories;
  try { categories = loadTaxonomy(a["fetch-src"]); }
  catch (e) { return finish({ ok: false, fatal: [e.message], warnings: [], stats: {} }); }

  const pre = [];
  const opt = (flag, label) => {
    if (!a[flag]) return undefined;
    try { return readJson(a[flag]); } catch (e) { pre.push(`${label} ${a[flag]} unreadable (${e.message}); check skipped`); return undefined; }
  };
  const report = opt("report", "source report");
  const floors = opt("floors", "floors file");
  const history = a.history ? readHistory(a.history) : [];
  const published = history.filter((r) => r && r.outcome === "published").length;
  const liveTotal = a["live-url"] && published < 3 ? await fetchTotal(a["live-url"]) : undefined;
  if (a["live-url"] && published < 3 && liveTotal === undefined) pre.push(`live feed ${a["live-url"]} unreadable; no delta baseline`);

  const acceptFileExists = fs.existsSync(acceptFile);
  const res = validateFeed(feed, { categories, today: a.today, floors, report, history, liveTotal, acceptDelta: a.acceptDelta, acceptFileExists });
  res.warnings.unshift(...pre);
  // The one-shot file is consumed only when it actually downgraded a delta fatal.
  if (acceptFileExists && !a.acceptDelta && res.stats.deltaDowngraded) {
    try { fs.unlinkSync(acceptFile); res.warnings.push(`delta: consumed one-shot ${path.basename(acceptFile)}`); }
    catch (e) { res.warnings.push(`delta: could not consume ${acceptFile}: ${e.message}`); }
  }
  return finish(res);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
}
