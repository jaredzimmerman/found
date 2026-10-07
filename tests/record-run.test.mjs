// Offline tests for build/record-run.mjs (C5). No network, no deps.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildRecord, computeStatus, trimLines, parseHistory, parseArgs, OUTCOMES } from "../build/record-run.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "build", "record-run.mjs");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  -> " + detail : ""}`); }
}
const rec = (outcome, extra = {}) => ({ ts: "2026-10-07T00:00:00Z", run_id: `r-${outcome}`, outcome, stage: "x", total: 100, sources: {}, ...extra });

// --- buildRecord ---------------------------------------------------------------
const r = buildRecord({
  ts: "2026-10-07T01:02:03Z", runId: "R1", outcome: "rejected", stage: "validate", startedS: 100, nowS: 161.4,
  feed: { events: [1, 2, 3] },
  report: { sources: { dothebay: { status: "ok", kept: 2 }, luma: { status: "failed", kept: null } } },
  validateReport: { ok: false, fatal: ["bad categories"], warnings: ["w1", "w2"] },
  sha: "abc123\n", fatal: ["extra"],
});
const keys = ["ts", "run_id", "outcome", "stage", "total", "sources", "duration_s", "sha", "warnings", "fatal"];
check("record has exactly the C5 keys", JSON.stringify(Object.keys(r)) === JSON.stringify(keys), Object.keys(r).join(","));
check("record total/duration/sha/warnings", r.total === 3 && r.duration_s === 61 && r.sha === "abc123" && r.warnings === 2);
check("record sources map name->kept (non-number -> 0)", r.sources.dothebay === 2 && r.sources.luma === 0);
check("rejected record carries validator fatal + script fatal", r.fatal.length === 2 && r.fatal[0] === "bad categories" && r.fatal[1] === "extra");
const pub = buildRecord({ ts: "t", runId: "R", outcome: "published", validateReport: { fatal: ["stale"], warnings: [] } });
check("non-rejected record ignores validator fatal; missing feed -> total null", pub.fatal.length === 0 && pub.total === null && pub.sha === null && pub.duration_s === null);
let threw = false; try { buildRecord({ outcome: "bogus" }); } catch { threw = true; }
check("unknown outcome throws", threw);
check("six outcomes", OUTCOMES.length === 6 && OUTCOMES.includes("locked-skip"));
const many = buildRecord({ ts: "t", runId: "R", outcome: "fatal", fatal: Array.from({ length: 30 }, (_, i) => "x".repeat(i === 0 ? 1000 : 3)) });
check("fatal list capped (20) and entries truncated", many.fatal.length === 20 && many.fatal[0].length < 500);

// --- trimLines / parseHistory ---------------------------------------------------
const six = Array.from({ length: 600 }, (_, i) => JSON.stringify({ i })).join("\n") + "\n";
const t = trimLines(six, 500);
check("trimLines keeps the last 500", t.split("\n").filter(Boolean).length === 500 && JSON.parse(t.split("\n")[0]).i === 100);
check("parseHistory skips torn lines", parseHistory('{"a":1}\n{"b":\n{"c":3}\n').length === 2);

// --- computeStatus -------------------------------------------------------------
const h = [
  rec("published", { run_id: "p1", total: 90, sources: { dothebay: 80, luma: 0 } }),
  rec("fatal", { sources: { dothebay: 0, luma: 0 } }),
  rec("dry-run", { sources: { dothebay: 70, luma: 0 } }),
  rec("locked-skip", { total: null }),
  rec("rejected", { run_id: "last", stage: "validate", sources: { dothebay: 0, luma: 0 } }),
];
const s = computeStatus(h, null, { deployedSha: "deadbeef", feedGeneratedAt: "2026-10-07T00:00:00Z" });
check("status has the C5 keys", ["last_attempt", "last_success", "consecutive_failures", "sources", "deployed_sha", "feed_generatedAt"].every((k) => k in s));
check("last_attempt is the newest record", s.last_attempt.run_id === "last" && s.last_attempt.outcome === "rejected" && s.last_attempt.stage === "validate");
check("last_success is the newest published", s.last_success.run_id === "p1" && s.last_success.total === 90);
check("consecutive_failures counts fatal+rejected, skips dry-run/locked-skip", s.consecutive_failures === 2, String(s.consecutive_failures));
check("zero_streak: dothebay 1 (dry-run had 70), luma 4", s.sources.dothebay.zero_streak === 1 && s.sources.luma.zero_streak === 4 && s.sources.dothebay.kept === 0, JSON.stringify(s.sources));
check("deployed_sha / feed_generatedAt passed through", s.deployed_sha === "deadbeef" && s.feed_generatedAt === "2026-10-07T00:00:00Z");
const s2 = computeStatus([rec("fatal")], { last_success: { ts: "old", run_id: "o", total: 5 }, deployed_sha: "prev", feed_generatedAt: "g" });
check("last_success/deployed_sha/feed_generatedAt fall back to previous status", s2.last_success.run_id === "o" && s2.deployed_sha === "prev" && s2.feed_generatedAt === "g");
check("no history and no previous -> last_success null, 0 failures", (() => { const x = computeStatus([rec("published")].slice(1), null); return x.last_success === null && x.consecutive_failures === 0 && x.last_attempt === null; })());
check("published resets consecutive_failures", computeStatus([rec("fatal"), rec("published")], null).consecutive_failures === 0);

// --- parseArgs ------------------------------------------------------------------
threw = false; try { parseArgs(["--history", "h", "--status", "s", "--outcome", "nope", "--run-id", "r"]); } catch { threw = true; }
check("parseArgs rejects unknown outcome", threw);
threw = false; try { parseArgs(["--history", "h"]); } catch { threw = true; }
check("parseArgs requires status/outcome/run-id", threw);

// --- CLI end to end -------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "record-run-"));
try {
  const H = path.join(tmp, "logs", "history.jsonl"), S = path.join(tmp, "logs", "status.json");
  const ev = path.join(tmp, "events.json"); fs.writeFileSync(ev, JSON.stringify({ generatedAt: "2026-10-07T05:00:00Z", events: [{}, {}] }));
  const rep = path.join(tmp, "rep.json"); fs.writeFileSync(rep, JSON.stringify({ sources: { dothebay: { status: "ok", kept: 2 } } }));
  const sha = path.join(tmp, "sha"); fs.writeFileSync(sha, "cafef00d\n");
  const ff = path.join(tmp, "fatal.txt"); fs.writeFileSync(ff, "first fatal\nsecond fatal\n");
  const cli = (...args) => spawnSync(process.execPath, [CLI, "--history", H, "--status", S, ...args], { encoding: "utf8" });

  let p = cli("--outcome", "published", "--stage", "done", "--run-id", "A", "--started", String(Date.now() / 1000 - 5),
    "--events", ev, "--report", rep, "--sha-file", sha, "--live-events", ev);
  check("CLI published exits 0", p.status === 0, p.stderr);
  let hist = parseHistory(fs.readFileSync(H, "utf8"));
  let st = JSON.parse(fs.readFileSync(S, "utf8"));
  check("CLI writes history line with total/sources/sha", hist.length === 1 && hist[0].total === 2 && hist[0].sources.dothebay === 2 && hist[0].sha === "cafef00d" && hist[0].duration_s >= 4);
  check("CLI writes status.json", st.last_success.run_id === "A" && st.deployed_sha === "cafef00d" && st.feed_generatedAt === "2026-10-07T05:00:00Z" && st.consecutive_failures === 0);

  p = cli("--outcome", "fatal", "--stage", "fetch", "--run-id", "B", "--fatal-file", ff, "--fatal", "third");
  hist = parseHistory(fs.readFileSync(H, "utf8")); st = JSON.parse(fs.readFileSync(S, "utf8"));
  check("CLI fatal: fatal-file lines + --fatal, total null", p.status === 0 && hist[1].fatal.join("|") === "first fatal|second fatal|third" && hist[1].total === null);
  check("CLI fatal: status keeps last_success, counts failure, keeps sha", st.last_success.run_id === "A" && st.consecutive_failures === 1 && st.last_attempt.outcome === "fatal" && st.deployed_sha === "cafef00d");

  const before = fs.readFileSync(S, "utf8");
  fs.appendFileSync(H, '{"torn":'); // a killed writer left half a line
  p = cli("--outcome", "locked-skip", "--stage", "lock", "--run-id", "C");
  hist = parseHistory(fs.readFileSync(H, "utf8"));
  check("CLI locked-skip appends history (after a torn line) and leaves status untouched", p.status === 0 && hist[hist.length - 1].outcome === "locked-skip" && fs.readFileSync(S, "utf8") === before);

  fs.writeFileSync(H, Array.from({ length: 600 }, (_, i) => JSON.stringify(rec("published", { run_id: `old${i}` }))).join("\n") + "\n");
  p = cli("--outcome", "dry-run", "--stage", "validate", "--run-id", "D");
  const lines = fs.readFileSync(H, "utf8").split("\n").filter(Boolean);
  check("CLI trims history to 500 lines, newest last", p.status === 0 && lines.length === 500 && JSON.parse(lines[499]).run_id === "D" && JSON.parse(lines[0]).run_id === "old101");
  check("CLI leaves no temp files", fs.readdirSync(path.join(tmp, "logs")).every((f) => !f.includes(".tmp-")));

  p = cli("--outcome", "weird", "--run-id", "E");
  check("CLI bad outcome exits 2", p.status === 2);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
