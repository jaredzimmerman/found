// Replay preload for the replay harness (PLAN C10). Loaded with
//   node --import /path/to/replay-preload.mjs fetch.mjs
// It makes a scraper run OFFLINE and DETERMINISTIC:
//   - globalThis.fetch is served from $REPLAY_FIXTURES/<sha1("GET <url>")>.json
//   - child_process.execFileSync("curl", ...) is served from the curl fixtures
//     (any other child process, and every other child_process entry point,
//     throws: nothing may reach the network or the host)
//   - net sockets throw, so a code path that bypasses fetch cannot go online
//   - `import("playwright")` fails as "not found", as it does on DreamHost
//   - no-arg `new Date()`, `Date()` and `Date.now()` return meta.json frozenNow
//     (constructors with arguments are untouched)
//   - REPLAY_FAST=1 (default): setTimeout / timers/promises delays of <= 5 s
//     run at 0 ms (pacing and retry backoff); longer delays are left alone
//     because they are request timeouts, which a replayed response never hits.
// A fixture MISS throws a clear error at the call site AND is recorded: the
// process exit code becomes 3 and the misses are written to $REPLAY_MISSES (if
// set), because the scrapers catch per-request errors and would otherwise
// carry on as if the source were down.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { syncBuiltinESMExports, register } from "node:module";
import cp from "node:child_process";
import net from "node:net";
import timersPromises from "node:timers/promises";

const DIR = resolve(process.env.REPLAY_FIXTURES || "fixtures");
const metaFile = join(DIR, "meta.json");
if (!existsSync(metaFile)) {
  throw new Error(`[replay] no fixtures: ${metaFile} missing. Record first (tests/replay/record.sh) or restore the tarball (see tests/replay/README.md).`);
}
const META = JSON.parse(readFileSync(metaFile, "utf8"));

const misses = [];
const keyFile = (key) => join(DIR, createHash("sha1").update(key).digest("hex") + ".json");
function load(key) {
  const f = keyFile(key);
  if (!existsSync(f)) {
    misses.push(key);
    const msg = `[replay] fixture MISS (no recorded response, refusing to go to the network): ${key}`;
    console.error(msg);
    throw new Error(msg);
  }
  return JSON.parse(readFileSync(f, "utf8"));
}

process.on("exit", (code) => {
  if (!misses.length) return;
  console.error(`[replay] ${misses.length} fixture miss(es); this replay is NOT valid.`);
  if (process.env.REPLAY_MISSES) {
    try { writeFileSync(process.env.REPLAY_MISSES, misses.join("\n") + "\n"); } catch { /* reported above */ }
  }
  if (!code) process.exitCode = 3;
});

// ---- frozen time -----------------------------------------------------------
const RealDate = Date;
const NOW = RealDate.parse(process.env.REPLAY_NOW || META.frozenNow);
if (Number.isNaN(NOW)) throw new Error(`[replay] bad frozenNow in ${metaFile}`);
function FrozenDate(...a) {
  if (!new.target) return new RealDate(NOW).toString();
  return Reflect.construct(RealDate, a.length ? a : [NOW], new.target);
}
FrozenDate.prototype = RealDate.prototype;
FrozenDate.now = () => NOW;
FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;
globalThis.Date = FrozenDate;

// ---- instant pacing ----------------------------------------------------------
if (process.env.REPLAY_FAST !== "0") {
  const FAST_MAX_MS = 5000;
  const shrink = (ms) => (typeof ms === "number" && ms <= FAST_MAX_MS ? 0 : ms);
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = function (fn, ms, ...rest) { return realSetTimeout(fn, shrink(ms), ...rest); };
  const realSleep = timersPromises.setTimeout;
  timersPromises.setTimeout = (ms, ...rest) => realSleep(shrink(ms), ...rest);
}

// ---- fetch -----------------------------------------------------------------
function requestKey(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
  return `${method} ${url}`;
}

globalThis.fetch = async function replayFetch(input, init) {
  const signal = (init && init.signal) || (input && typeof input === "object" && input.signal);
  if (signal && signal.aborted) throw signal.reason ?? new Error("aborted");
  const rec = load(requestKey(input, init));
  if (rec.error) {
    const e = new Error(rec.error.message);
    e.name = rec.error.name || "Error";
    throw e;
  }
  const body = Buffer.from(rec.bodyBase64 || "", "base64");
  const nullBody = [101, 204, 205, 304].includes(rec.status);
  const res = new Response(nullBody ? null : body, { status: rec.status, statusText: rec.statusText || "", headers: rec.headers || [] });
  Object.defineProperty(res, "url", { value: rec.url || "" });
  return res;
};

// ---- child processes -----------------------------------------------------------
function curlKey(args) {
  const norm = [...args];
  for (let i = 0; i < norm.length - 1; i++) {
    if (norm[i] === "-o" && norm[i + 1] !== "/dev/null") norm[i + 1] = "<OUTFILE>";
  }
  return `CURL ${JSON.stringify(norm)}`;
}

cp.execFileSync = function replayExecFileSync(file, args, opts) {
  if (file !== "curl" || !Array.isArray(args)) {
    throw new Error(`[replay] execFileSync(${JSON.stringify(file)}) is not replayable; only curl is recorded`);
  }
  const rec = load(curlKey(args));
  const enc = opts && typeof opts === "object" ? opts.encoding : typeof opts === "string" ? opts : undefined;
  const stdout = Buffer.from(rec.stdoutBase64 || "", "base64");
  const asOut = (b) => (enc && enc !== "buffer" ? b.toString(enc) : b);
  if (rec.error) {
    const e = new Error(rec.error.message);
    e.status = rec.error.status;
    e.signal = rec.error.signal;
    if (rec.error.code) e.code = rec.error.code;
    e.stdout = asOut(stdout);
    e.stderr = asOut(Buffer.alloc(0));
    throw e;
  }
  const oi = args.indexOf("-o");
  if (oi >= 0 && args[oi + 1] !== "/dev/null" && rec.outFileBase64 != null) {
    writeFileSync(args[oi + 1], Buffer.from(rec.outFileBase64, "base64"));
  }
  return asOut(stdout);
};
for (const name of ["exec", "execFile", "execSync", "spawn", "spawnSync", "fork"]) {
  cp[name] = () => { throw new Error(`[replay] child_process.${name} is blocked during replay`); };
}
syncBuiltinESMExports();

// ---- no sockets ----------------------------------------------------------------
net.Socket.prototype.connect = function () {
  throw new Error("[replay] network socket blocked during replay (a request bypassed the fetch/curl fixtures)");
};

// ---- optional modules absent, as on DreamHost ------------------------------------
const BLOCKED = (process.env.REPLAY_BLOCK_MODULES || "playwright").split(",").filter(Boolean);
const hooks = `
const BLOCKED = new Set(${JSON.stringify(BLOCKED)});
export async function resolve(specifier, context, next) {
  if (BLOCKED.has(specifier)) {
    const e = new Error("Cannot find package '" + specifier + "' (blocked by replay-preload)");
    e.code = "ERR_MODULE_NOT_FOUND";
    throw e;
  }
  return next(specifier, context);
}`;
register("data:text/javascript," + encodeURIComponent(hooks));
