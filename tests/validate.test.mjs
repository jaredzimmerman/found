// Offline tests for build/validate-feed.mjs (C3, C4). No network, no deps.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateFeed, loadTaxonomy, taxonomyFromSource, median } from "../build/validate-feed.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "build", "validate-feed.mjs");
const GOOD = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/feed-good.json"), "utf8"));
const FLOORS = JSON.parse(fs.readFileSync(path.join(ROOT, "build/source-floors.json"), "utf8"));
const categories = loadTaxonomy();
const TODAY = "2026-10-07";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  -> " + detail : ""}`); }
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const run = (feed, ctx = {}) => validateFeed(feed, { categories, today: TODAY, ...ctx });
const has = (arr, ...subs) => arr.some((m) => subs.every((s) => m.includes(s)));
const hist = (totals, outcome = "published") => totals.map((t, i) => ({ ts: `2026-10-0${i + 1}T00:00:00Z`, run_id: `r${i}`, outcome, total: t }));
const report = (o) => ({ sources: Object.fromEntries(Object.entries(o).map(([k, kept]) => [k, { status: "ok", reason: null, registered: kept, kept }])) });

// --- taxonomy ----------------------------------------------------------------
check("taxonomy derived from fetch.mjs has the 11 categories", categories.length === 11 && categories.includes("Sports & Fitness") && categories.includes("Community"), String(categories));
check("taxonomyFromSource picks up MAP/KEYWORDS-only values", taxonomyFromSource(
  'const CATEGORIES = [\n "A1",\n "B2",\n "C3",\n "D4",\n];\nconst MAP = {\n x: "Mapped Only",\n};\nconst KEYWORDS = [\n  [/a/, "Kw Only"],\n];\n').includes("Mapped Only") );
check("taxonomyFromSource includes KEYWORDS-only category", taxonomyFromSource(
  'const CATEGORIES = [\n "A1",\n "B2",\n "C3",\n "D4",\n];\nconst KEYWORDS = [\n  [/a/, "Kw Only"],\n];\n').includes("Kw Only"));
let threw = false; try { validateFeed(GOOD, {}); } catch { threw = true; }
check("validateFeed without ctx.categories throws (no hidden I/O)", threw);

// --- good feed ---------------------------------------------------------------
const g = run(GOOD);
check("good fixture has 60 events and real envelope keys", GOOD.events.length === 60 && ["generatedAt", "days", "counts", "neighborhoods"].every((k) => k in GOOD));
check("good feed passes", g.ok && g.fatal.length === 0, g.fatal.join(" | "));
check("good feed stats.total = 60", g.stats.total === 60);
const before = JSON.stringify(GOOD);
run(GOOD, { floors: FLOORS, report: report({ dothebay: 100 }), history: hist([60, 60, 60]) });
check("validateFeed never mutates the feed", JSON.stringify(GOOD) === before);

// --- regression: the 2026-10-07 bad feed ---------------------------------------
const bad = clone(GOOD);
for (let i = 0; i < 12; i++) { bad.events[i].categories = bad.events[i].categories[0]; bad.events[i].venue = i === 0 ? null : bad.events[i].venue; }
bad.events[0].venue = null; // null venue is legal alone (string|null)
const b = run(bad);
check("REGRESSION: 12 string-categories events are rejected", !b.ok);
check("REGRESSION: each offending event id and field is reported", GOOD.events.slice(0, 12).every((e) => has(b.fatal, `event ${e.id}`, "categories", "got string")));
const venueNull = clone(GOOD); venueNull.events[3].venue = null;
check("null venue alone is allowed (venue is string|null)", run(venueNull).ok);
const addrNull = clone(GOOD); addrNull.events[3].address = null;
check("null address alone is allowed", run(addrNull).ok);
const nullTitle = clone(GOOD); nullTitle.events[2].title = null;
const nt = run(nullTitle);
check("null where a string is required (title) is fatal, with id+field", !nt.ok && has(nt.fatal, `event ${GOOD.events[2].id}`, "title"));
const numVenue = clone(GOOD); numVenue.events[2].venue = 5;
check("non-string non-null venue is fatal", !run(numVenue).ok && has(run(numVenue).fatal, "venue"));

// --- per-event schema ----------------------------------------------------------
const dup = clone(GOOD); dup.events[5].id = dup.events[4].id;
const d = run(dup);
check("duplicate ids are fatal and name the id", !d.ok && has(d.fatal, `event ${dup.events[4].id}`, "duplicate id"));
const emptyId = clone(GOOD); emptyId.events[0].id = "";
check("empty id is fatal", !run(emptyId).ok && has(run(emptyId).fatal, "id"));
const src = clone(GOOD); src.events[7].source = "dothebay";
const s = run(src);
check("`source` key present is fatal", !s.ok && has(s.fatal, `event ${src.events[7].id}`, "source"));
const badDate = clone(GOOD); badDate.events[1].date = "10/08/2026";
check("bad date format is fatal", !run(badDate).ok && has(run(badDate).fatal, "date", "YYYY-MM-DD"));
const impossible = clone(GOOD); impossible.events[1].date = "2026-02-30";
check("impossible calendar date is fatal", !run(impossible).ok);
const outDay = clone(GOOD); outDay.events[1].date = "2026-11-01";
check("event date outside `days` is fatal", !run(outDay).ok && has(run(outDay).fatal, "not in feed.days"));
const emptyCats = clone(GOOD); emptyCats.events[9].categories = [];
{ const r = run(emptyCats);
  check("empty categories is only a warning (SF Station rows are uncategorised by design)", r.ok && r.fatal.length === 0 && r.warnings.some((w) => w.includes("empty categories list") && w.includes(emptyCats.events[9].id)));
  check("empty categories is counted in stats", r.stats.emptyCategories === 1); }
const nonArrCats = clone(GOOD); nonArrCats.events[9].categories = "Comedy";
check("string categories is still fatal", !run(nonArrCats).ok && has(run(nonArrCats).fatal, `event ${nonArrCats.events[9].id}`, "categories"));
const unk = clone(GOOD); unk.events[9].categories = ["Community", "Underwater Basket Weaving"];
check("unknown category is fatal and names it", !run(unk).ok && has(run(unk).fatal, "unknown category", "Underwater Basket Weaving"));
const nonStrCat = clone(GOOD); nonStrCat.events[9].categories = [7];
check("non-string category entry is fatal", !run(nonStrCat).ok);
const badUrl = clone(GOOD); badUrl.events[2].url = "javascript:alert(1)";
check("non-http(s) url is fatal", !run(badUrl).ok && has(run(badUrl).fatal, "url"));
const badTier = clone(GOOD); badTier.events[2].linkTier = "social";
check("linkTier outside the 4 allowed values is fatal", !run(badTier).ok && has(run(badTier).fatal, "linkTier"));
const badMin = clone(GOOD); badMin.events[2].startMinutes = "600";
check("non-integer startMinutes is fatal", !run(badMin).ok && has(run(badMin).fatal, "startMinutes"));
const unknownEnd = clone(GOOD); unknownEnd.events[2].endMinutes = -1;
check("endMinutes -1 (real 'unknown' sentinel) is accepted", run(unknownEnd).ok);
const badPrice = clone(GOOD); badPrice.events[2].priceTier = null;
check("non-string priceTier is fatal", !run(badPrice).ok && has(run(badPrice).fatal, "priceTier"));
const manyBad = clone(GOOD); manyBad.events.forEach((e) => { e.categories = "Community"; });
const mb = run(manyBad);
check("fatal list is capped but states the total", mb.fatal.length < 60 && has(mb.fatal, "more event problems", "60 events affected"));

// --- envelope --------------------------------------------------------------------
const shortDays = clone(GOOD); shortDays.days = shortDays.days.slice(0, 2);
check("`days` wrong length is fatal", !run(shortDays).ok && has(run(shortDays).fatal, "expected 3 entries"));
const noToday = clone(GOOD);
check("missing today in `days` is fatal", !run(noToday, { today: "2026-10-20" }).ok && has(run(noToday, { today: "2026-10-20" }).fatal, "does not include today"));
const notArr = clone(GOOD); notArr.days = "2026-10-07";
check("`days` not an array is fatal", !run(notArr).ok);
const noEvents = clone(GOOD); noEvents.events = [];
check("empty events array is fatal", !run(noEvents).ok);
check("non-object feed is fatal", !run(null).ok && !run([]).ok);

// --- floors (C3) -------------------------------------------------------------------
const okRep = report({ dothebay: 120, funcheap: 20, foopee: 9, luma: 3, sfstation: 5 });
check("all floors met -> no floor messages", (() => { const r = run(GOOD, { floors: FLOORS, report: okRep }); return r.ok && !has(r.warnings, "floor"); })());
const reqBreach = run(GOOD, { floors: FLOORS, report: report({ dothebay: 12, funcheap: 20, foopee: 9, luma: 3, sfstation: 5 }) });
check("REQUIRED source below its min is fatal", !reqBreach.ok && has(reqBreach.fatal, "dothebay", "below its floor of 60"));
const optBreach = run(GOOD, { floors: FLOORS, report: report({ dothebay: 120, funcheap: 1, foopee: 9, luma: 3, sfstation: 5 }) });
check("OPTIONAL source below its min is only a warning", optBreach.ok && has(optBreach.warnings, "funcheap", "below its floor of 8", "[optional]"));
const ci = run(GOOD, { floors: FLOORS, report: { sources: { DoTheBay: { status: "ok", kept: 90 }, FunCheap: { status: "ok", kept: 20 } } } });
check("source-name matching is case-insensitive", ci.ok && !has(ci.fatal, "dothebay") && !has(ci.warnings, "dothebay", "no entry"));
const missing = run(GOOD, { floors: FLOORS, report: report({ dothebay: 120 }) });
check("floors entry with no report entry is a warning, not fatal", missing.ok && has(missing.warnings, "funcheap", "no entry in the source report"));
const missingReq = run(GOOD, { floors: { dothebay: { min: 60, required: true } }, report: report({ other: 5 }) });
check("even a REQUIRED floor with no report entry is only a warning", missingReq.ok && has(missingReq.warnings, "dothebay", "no entry"));
const failedSrc = run(GOOD, { floors: FLOORS, report: { sources: { dothebay: { status: "failed", reason: "HTTP 503", kept: 0 } } } });
check("failed required source reports its status and reason", !failedSrc.ok && has(failedSrc.fatal, "status failed", "HTTP 503"));
check("no report supplied -> warning per floor, not fatal", (() => { const r = run(GOOD, { floors: FLOORS }); return r.ok && has(r.warnings, "no source report"); })());
check("source-floors.json seed matches the brief", FLOORS.dothebay.min === 60 && FLOORS.dothebay.required === true && FLOORS.funcheap.min === 8 && FLOORS.foopee.min === 5 && FLOORS.luma.min === 2 && FLOORS.sfstation.min === 3 && ["funcheap", "foopee", "luma", "sfstation"].every((k) => FLOORS[k].required === false));

// --- delta guard (C4 d) ----------------------------------------------------------------
check("median helper", median([3, 1, 2]) === 2 && median([1, 2, 3, 4]) === 2.5 && median([]) === null);
const h200 = hist([200, 210, 190, 205, 195, 200, 200]); // median 200
const mkFeed = (n) => { const f = clone(GOOD); f.events = Array.from({ length: n }, (_, i) => ({ ...clone(GOOD.events[i % 60]), id: `x-${i}` })); return f; };
const low = run(mkFeed(100), { history: h200 });
check("history >= 3: total below 60% of median(last 7) is FATAL", !low.ok && has(low.fatal, "delta:", "50%", "median of the last 7"));
check("history >= 3: exactly 60% of the median is not fatal", run(mkFeed(120), { history: h200 }).ok);
check("history >= 3: 119 of 200 (59.5%) is fatal", !run(mkFeed(119), { history: h200 }).ok);
const hi = run(mkFeed(400), { history: h200 });
check(">160% is only a WARNING", hi.ok && has(hi.warnings, "delta:", "above 160%"));
check("exactly 160% raises nothing", (() => { const r = run(mkFeed(320), { history: h200 }); return r.ok && !has(r.warnings, "delta:"); })());
const mixed = [...hist([1000, 1000, 1000], "rejected"), ...hist([100, 100, 100])];
check("only `published` runs count toward the baseline", run(mkFeed(100), { history: mixed }).ok);
const longHist = hist([10, 10, 10, 10, 10, 10, 10, 200, 200, 200, 200, 200, 200, 200].map((x) => x));
check("only the LAST 7 published runs are used", !run(mkFeed(100), { history: longHist }).ok && run(mkFeed(120), { history: longHist }).ok);
const shortHist = hist([200, 200]);
const sh = run(mkFeed(100), { history: shortHist, liveTotal: 200 });
check("<3 published runs -> falls back to ctx.liveTotal (fatal below 60%)", !sh.ok && has(sh.fatal, "live feed total", "only 2 published"));
check("<3 published runs ignores the short history's own numbers", run(mkFeed(100), { history: hist([1000, 1000]), liveTotal: 120 }).ok);
check("<3 published runs, ctx.liveTotal, high side warns", (() => { const r = run(mkFeed(400), { history: [], liveTotal: 200 }); return r.ok && has(r.warnings, "above 160%"); })());
const nb = run(mkFeed(100), { history: [] });
check("no history and no liveTotal -> delta skipped with a warning", nb.ok && has(nb.warnings, "no baseline"));
check("--accept-delta (ctx.acceptDelta) downgrades delta fatal to warning", (() => { const r = run(mkFeed(100), { history: h200, acceptDelta: true }); return r.ok && has(r.warnings, "[accepted]") && r.stats.deltaDowngraded === true; })());
check("accept does not hide other fatals", !run(mkMixedBad(), { history: h200, acceptDelta: true }).ok);
function mkMixedBad() { const f = mkFeed(100); f.events[0].categories = "Community"; return f; }

// --- CLI ------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "validate-test-"));
const w = (name, data) => { const p = path.join(tmp, name); fs.writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data)); return p; };
const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
const base = (extra = []) => ["--events", w("events.json", GOOD), "--today", TODAY, "--out", path.join(tmp, "out.json"), "--accept-file", path.join(tmp, ".accept-delta"), ...extra];
const histPath = w("history.jsonl", hist([200, 200, 200]).map((r) => JSON.stringify(r)).join("\n") + "\nnot json\n");

let r = cli(base());
check("CLI: good feed exits 0 and writes the report", r.status === 0 && JSON.parse(fs.readFileSync(path.join(tmp, "out.json"), "utf8")).ok === true, r.stdout + r.stderr);
r = cli(["--events", w("badfeed.json", bad), "--today", TODAY, "--out", path.join(tmp, "out2.json")]);
const rep2 = JSON.parse(fs.readFileSync(path.join(tmp, "out2.json"), "utf8"));
check("CLI: the regression feed exits 1 with ok=false and fatal[]", r.status === 1 && rep2.ok === false && rep2.fatal.length >= 12 && "stats" in rep2 && "warnings" in rep2);
r = cli(base(["--history", histPath]));
check("CLI: delta fatal (60 of median 200) exits 1; torn history line is ignored", r.status === 1 && r.stdout.includes("delta:"), r.stdout);
r = cli(base(["--history", histPath, "--accept-delta"]));
check("CLI: --accept-delta exits 0 with a warning", r.status === 0 && r.stdout.includes("[accepted]"), r.stdout);
fs.writeFileSync(path.join(tmp, ".accept-delta"), "");
r = cli(base(["--history", histPath]));
check("CLI: one-shot .accept-delta file downgrades the delta fatal", r.status === 0 && r.stdout.includes("[accepted]"), r.stdout);
check("CLI: the one-shot file is consumed on use", !fs.existsSync(path.join(tmp, ".accept-delta")));
r = cli(base(["--history", histPath]));
check("CLI: after consumption the same run is fatal again", r.status === 1);
fs.writeFileSync(path.join(tmp, ".accept-delta"), "");
r = cli(base());
check("CLI: .accept-delta is NOT consumed when no delta fatal needed it", r.status === 0 && fs.existsSync(path.join(tmp, ".accept-delta")));
fs.unlinkSync(path.join(tmp, ".accept-delta"));
const histHi = w("hist-hi.jsonl", hist([20, 20, 20]).map((x) => JSON.stringify(x)).join("\n"));
r = cli(base(["--history", histHi]));
check("CLI: >160% is only a warning (exit 0)", r.status === 0 && r.stdout.includes("above 160%"), r.stdout);
const fl = w("floors.json", FLOORS), rp = w("report.json", report({ dothebay: 5 }));
r = cli(base(["--floors", fl, "--report", rp]));
check("CLI: required floor breach exits 1", r.status === 1 && r.stdout.includes("dothebay"), r.stdout);
r = cli(["--events", path.join(tmp, "nope.json"), "--out", path.join(tmp, "o3.json")]);
check("CLI: unreadable events file exits 1", r.status === 1);
r = cli(["--bogus"]);
check("CLI: unknown flag exits 2", r.status === 2);
r = cli(base(["--history", path.join(tmp, "missing.jsonl")]));
check("CLI: missing history file is treated as empty (exit 0)", r.status === 0);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
