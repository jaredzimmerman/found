// Record preload for the replay harness (PLAN C10). Loaded with
//   node --import /path/to/record-preload.mjs fetch.mjs
// inside a THROWAWAY copy of build/ on DreamHost (see record.sh). It lets every
// request go to the real network and writes what came back to
// $REPLAY_FIXTURES/<sha1(key)>.json so replay-preload.mjs can serve it later.
//
// What it wraps (every external input fetch.mjs and dc-fetch.mjs have):
//   - globalThis.fetch                key = "GET <url>" (method from init/Request)
//   - child_process.execFileSync curl key = "CURL <json args>" (sync TLS probes,
//     shortener HEADs and sucuri.mjs; `-o <file>` is normalized and the file's
//     bytes are stored so the replay can write them back)
//   - Date: frozen to $REPLAY_NOW (set once by record.sh for both scripts) so
//     the window days and every "now" the code computes match the replay.
// Node 18.19 compatible (DreamHost runs v18.19.1).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import cp from "node:child_process";

const DIR = resolve(process.env.REPLAY_FIXTURES || "fixtures");
mkdirSync(DIR, { recursive: true });

const keyFile = (key) => join(DIR, createHash("sha1").update(key).digest("hex") + ".json");
const save = (key, rec) => {
  const f = keyFile(key);
  // First answer wins: the same URL fetched twice in one run is served the
  // first recorded response on replay, so the second recording is dropped.
  if (existsSync(f)) return;
  writeFileSync(f, JSON.stringify({ key, ...rec }));
};

// ---- frozen time -----------------------------------------------------------
const RealDate = Date;
const NOW = RealDate.parse(process.env.REPLAY_NOW || new RealDate().toISOString());
if (Number.isNaN(NOW)) throw new Error(`[record] bad REPLAY_NOW: ${process.env.REPLAY_NOW}`);
function FrozenDate(...a) {
  if (!new.target) return new RealDate(NOW).toString();
  return Reflect.construct(RealDate, a.length ? a : [NOW], new.target);
}
FrozenDate.prototype = RealDate.prototype;
FrozenDate.now = () => NOW;
FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;
globalThis.Date = FrozenDate;

// ---- fetch -----------------------------------------------------------------
const realFetch = globalThis.fetch;
const DROP_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding"]);

function requestKey(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
  return `${method} ${url}`;
}

globalThis.fetch = async function recordFetch(input, init) {
  const key = requestKey(input, init);
  let res;
  try {
    res = await realFetch(input, init);
  } catch (e) {
    save(key, { kind: "fetch", error: { name: e?.name || "Error", message: String(e?.message || e) } });
    throw e;
  }
  let buf;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    // Body read failed (e.g. timeout mid-body). Record it as a failed request:
    // the caller would have seen a throw from .json()/.text() at roughly the
    // same point.
    save(key, { kind: "fetch", error: { name: e?.name || "Error", message: String(e?.message || e) } });
    throw e;
  }
  const headers = [...res.headers].filter(([k]) => !DROP_HEADERS.has(k.toLowerCase()));
  save(key, {
    kind: "fetch",
    status: res.status,
    statusText: res.statusText,
    url: res.url,
    headers,
    bodyBase64: buf.toString("base64"),
  });
  const nullBody = [101, 204, 205, 304].includes(res.status);
  const out = new Response(nullBody ? null : buf, { status: res.status, statusText: res.statusText, headers });
  Object.defineProperty(out, "url", { value: res.url });
  return out;
};

// ---- curl via execFileSync ---------------------------------------------------
const realExecFileSync = cp.execFileSync;

export function curlKey(args) {
  const norm = [...args];
  for (let i = 0; i < norm.length - 1; i++) {
    if (norm[i] === "-o" && norm[i + 1] !== "/dev/null") norm[i + 1] = "<OUTFILE>";
  }
  return `CURL ${JSON.stringify(norm)}`;
}

cp.execFileSync = function recordExecFileSync(file, args, opts) {
  if (file !== "curl" || !Array.isArray(args)) return realExecFileSync.apply(this, arguments);
  const key = curlKey(args);
  const oi = args.indexOf("-o");
  const outFile = oi >= 0 && args[oi + 1] !== "/dev/null" ? args[oi + 1] : null;
  try {
    const out = realExecFileSync.apply(this, arguments);
    const stdout = Buffer.isBuffer(out) ? out : Buffer.from(String(out), "utf8");
    const rec = { kind: "curl", stdoutBase64: stdout.toString("base64") };
    if (outFile && existsSync(outFile)) rec.outFileBase64 = readFileSync(outFile).toString("base64");
    save(key, rec);
    return out;
  } catch (e) {
    const so = e?.stdout == null ? Buffer.alloc(0) : Buffer.isBuffer(e.stdout) ? e.stdout : Buffer.from(String(e.stdout));
    save(key, {
      kind: "curl",
      error: { message: String(e?.message || e).split("\n")[0], status: e?.status ?? null, signal: e?.signal ?? null, code: e?.code ?? null },
      stdoutBase64: so.toString("base64"),
    });
    throw e;
  }
};
syncBuiltinESMExports();

// Record whether optional modules were importable, so a replay on a machine
// that has them can be told apart from the recording host.
process.on("exit", () => {
  try {
    const f = join(DIR, "_env.json");
    const prev = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
    prev[process.argv[1] || "?"] = { node: process.version, tz: process.env.TZ || null, frozenNow: new RealDate(NOW).toISOString() };
    writeFileSync(f, JSON.stringify(prev, null, 2));
  } catch { /* best effort */ }
});
