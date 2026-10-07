// Run recorder for build-site.sh (plan contract C5). No dependencies; node 18+.
//
//   node build/record-run.mjs --history H --status S --outcome O --stage X
//        --run-id R --started EPOCH_S [--events F] [--report R] [--validate-report V]
//        [--sha-file F] [--live-events F] [--fatal-file F] [--fatal MSG]... [--max-lines N]
//
// Appends one line to logs/history.jsonl (trimmed to the last 500 lines) and
// overwrites logs/status.json, so build-site.sh never hand-builds JSON.
//
// Outcome locked-skip only APPENDS to history: the instance holding the lock owns
// status.json and the trim (it rewrites both when it finishes), and the skipped
// instance runs concurrently with it, so it must not rewrite either file.
//
// The pure parts (buildRecord, computeStatus, trimLines, parseHistory) do no I/O.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OUTCOMES = ["published", "rejected", "fatal", "dry-run", "stage-only", "locked-skip"];
export const MAX_LINES = 500;
const MAX_FATAL = 20;          // entries kept per record
const MAX_FATAL_LEN = 400;     // chars per entry

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
export function parseHistory(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (isObj(r)) out.push(r); } catch { /* torn line */ }
  }
  return out;
}

// Keep the last `max` non-empty lines; returns text ending in "\n" (or "").
export function trimLines(text, max = MAX_LINES) {
  const lines = String(text || "").split("\n").filter((l) => l.trim() !== "");
  const kept = lines.slice(-max);
  return kept.length ? kept.join("\n") + "\n" : "";
}

// inputs: {ts, runId, outcome, stage, startedS, nowS, feed, report, validateReport, sha, fatal[]}
export function buildRecord(inp) {
  if (!OUTCOMES.includes(inp.outcome)) throw new Error(`record-run: unknown outcome ${JSON.stringify(inp.outcome)}`);
  const sources = {};
  if (isObj(inp.report) && isObj(inp.report.sources)) {
    for (const [name, v] of Object.entries(inp.report.sources)) {
      sources[name] = isObj(v) && Number.isFinite(v.kept) ? v.kept : 0;
    }
  }
  const total = isObj(inp.feed) && Array.isArray(inp.feed.events) ? inp.feed.events.length : null;
  const vr = isObj(inp.validateReport) ? inp.validateReport : null;
  const fatal = [];
  if (vr && Array.isArray(vr.fatal) && inp.outcome === "rejected") fatal.push(...vr.fatal);
  for (const f of inp.fatal || []) if (typeof f === "string" && f.trim()) fatal.push(f.trim());
  const dur = Number.isFinite(inp.startedS) && Number.isFinite(inp.nowS) ? Math.max(0, Math.round(inp.nowS - inp.startedS)) : null;
  return {
    ts: inp.ts,
    run_id: String(inp.runId || ""),
    outcome: inp.outcome,
    stage: String(inp.stage || ""),
    total,
    sources,
    duration_s: dur,
    sha: typeof inp.sha === "string" && inp.sha.trim() ? inp.sha.trim() : null,
    warnings: vr && Array.isArray(vr.warnings) ? vr.warnings.length : 0,
    fatal: fatal.slice(0, MAX_FATAL).map((s) => (s.length > MAX_FATAL_LEN ? s.slice(0, MAX_FATAL_LEN) + "..." : s)),
  };
}

// history: records oldest first, INCLUDING the one just appended (the last).
// prev: the previous status.json object (or null). extra: {deployedSha, feedGeneratedAt}
export function computeStatus(history, prev, extra = {}) {
  const recs = (Array.isArray(history) ? history : []).filter(isObj);
  const last = recs[recs.length - 1] || null;
  const p = isObj(prev) ? prev : {};

  let lastSuccess = null;
  for (let i = recs.length - 1; i >= 0; i--) {
    if (recs[i].outcome === "published") {
      lastSuccess = { ts: recs[i].ts, run_id: recs[i].run_id, total: Number.isFinite(recs[i].total) ? recs[i].total : null };
      break;
    }
  }
  // Trimmed out of history: keep what the previous status knew.
  if (!lastSuccess && isObj(p.last_success)) lastSuccess = p.last_success;

  // Failures since the last publish; dry-run / stage-only / locked-skip neither
  // count nor reset.
  let consecutive = 0;
  for (let i = recs.length - 1; i >= 0; i--) {
    const o = recs[i].outcome;
    if (o === "published") break;
    if (o === "rejected" || o === "fatal") consecutive++;
  }

  // Per-source zero streaks over runs that actually fetched (records with sources).
  const withSrc = recs.filter((r) => isObj(r.sources) && Object.keys(r.sources).length);
  const sources = {};
  if (withSrc.length) {
    const newest = withSrc[withSrc.length - 1];
    for (const [name, kept] of Object.entries(newest.sources)) {
      let streak = 0;
      for (let i = withSrc.length - 1; i >= 0; i--) {
        const k = withSrc[i].sources[name];
        if (Number.isFinite(k) && k > 0) break;
        streak++;
      }
      sources[name] = { kept: Number.isFinite(kept) ? kept : 0, zero_streak: streak };
    }
  } else if (isObj(p.sources)) {
    Object.assign(sources, p.sources);
  }

  return {
    last_attempt: last ? { ts: last.ts, run_id: last.run_id, outcome: last.outcome, stage: last.stage } : null,
    last_success: lastSuccess,
    consecutive_failures: consecutive,
    sources,
    deployed_sha: extra.deployedSha ?? (typeof p.deployed_sha === "string" ? p.deployed_sha : null),
    feed_generatedAt: extra.feedGeneratedAt ?? (typeof p.feed_generatedAt === "string" ? p.feed_generatedAt : null),
  };
}

// ---------------------------------------------------------------------------
// CLI / I/O
// ---------------------------------------------------------------------------
const VALUED = new Set(["history", "status", "outcome", "stage", "run-id", "started", "events", "report",
  "validate-report", "sha-file", "live-events", "fatal-file", "fatal", "max-lines", "now"]);

export function parseArgs(argv) {
  const a = { fatal: [] };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    if (!m || !VALUED.has(m[1])) throw new Error(`record-run: unknown argument ${argv[i]}`);
    if (i + 1 >= argv.length) throw new Error(`record-run: --${m[1]} needs a value`);
    const v = argv[++i];
    if (m[1] === "fatal") a.fatal.push(v); else a[m[1]] = v;
  }
  for (const k of ["history", "status", "outcome", "run-id"]) if (!a[k]) throw new Error(`record-run: --${k} is required`);
  if (!OUTCOMES.includes(a.outcome)) throw new Error(`record-run: unknown outcome ${a.outcome}`);
  return a;
}

const readJson = (p) => { if (!p) return null; try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const readText = (p) => { if (!p) return null; try { return fs.readFileSync(p, "utf8"); } catch { return null; } };

function writeAtomic(p, text) {
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
}

export function recordRun(a) {
  const nowS = a.now ? Number(a.now) : Date.now() / 1000;
  const ts = new Date(nowS * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const fatal = [...a.fatal];
  const ff = readText(a["fatal-file"]);
  if (ff) fatal.unshift(...ff.split("\n").filter((l) => l.trim()));
  const sha = readText(a["sha-file"]);
  const rec = buildRecord({
    ts, runId: a["run-id"], outcome: a.outcome, stage: a.stage,
    startedS: a.started ? Number(a.started) : NaN, nowS,
    feed: readJson(a.events), report: readJson(a.report), validateReport: readJson(a["validate-report"]),
    sha, fatal,
  });

  fs.mkdirSync(path.dirname(a.history), { recursive: true });
  // One small O_APPEND write: concurrent appenders cannot interleave inside it.
  let prefix = "";
  try {
    const st = fs.statSync(a.history);
    if (st.size > 0) {
      const fd = fs.openSync(a.history, "r");
      const b = Buffer.alloc(1);
      fs.readSync(fd, b, 0, 1, st.size - 1);
      fs.closeSync(fd);
      if (b[0] !== 0x0a) prefix = "\n"; // a torn last line must not swallow ours
    }
  } catch { /* new file */ }
  fs.appendFileSync(a.history, prefix + JSON.stringify(rec) + "\n");
  if (a.outcome === "locked-skip") return { rec, status: null };

  const max = a["max-lines"] ? Number(a["max-lines"]) : MAX_LINES;
  const text = fs.readFileSync(a.history, "utf8");
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length > max) writeAtomic(a.history, trimLines(text, max));

  const prev = readJson(a.status);
  const live = readJson(a["live-events"]);
  const status = computeStatus(parseHistory(lines.slice(-max).join("\n")), prev, {
    deployedSha: sha && sha.trim() ? sha.trim() : null,
    feedGeneratedAt: live && typeof live.generatedAt === "string" ? live.generatedAt : null,
  });
  // Keep the deployed sha a previous run knew when this tree has none recorded.
  if (status.deployed_sha === null && prev && typeof prev.deployed_sha === "string") status.deployed_sha = prev.deployed_sha;
  if (status.feed_generatedAt === null && prev && typeof prev.feed_generatedAt === "string") status.feed_generatedAt = prev.feed_generatedAt;
  writeAtomic(a.status, JSON.stringify(status, null, 2) + "\n");
  return { rec, status };
}

export function main(argv) {
  let a;
  try { a = parseArgs(argv); } catch (e) { console.error(e.message); return 2; }
  try {
    const { rec } = recordRun(a);
    console.log(`recorded ${rec.outcome} run ${rec.run_id}: stage=${rec.stage} total=${rec.total ?? "-"} duration=${rec.duration_s ?? "-"}s warnings=${rec.warnings} fatal=${rec.fatal.length}`);
    return 0;
  } catch (e) {
    console.error(`record-run: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
