// ---------------------------------------------------------------------------
// The one way the scrapers read the network (PLAN C7)
// ---------------------------------------------------------------------------
// Before this, every source called `fetch()` itself: the DoTheBay JSON reader
// had no timeout at all, nothing retried a transient 503, and nothing bounded
// the run as a whole, so one stalled socket could hold the cron slot until the
// next run started on top of it. Every network read now comes through here.
//
//   getJson(url, opts)  -> parsed JSON          (per-attempt timeout 20 s)
//   getText(url, opts)  -> response body text   (per-attempt timeout 30 s)
//   startDeadline(ms)   -> global run deadline; after it, every call throws
//                          DeadlineError at once and the process exits 124
//   stopDeadline()      -> called just before the output file is written, so
//                          the deadline can never cut a write in half
//
// opts: headers (sent exactly as given: no header is ever added, so the
// User-Agent / Accept of each source is unchanged), timeoutMs, withMeta
// (resolve to { data, status, headers, url } instead of the body).
// Test seams: retries, backoffMs, jitter, retryAfterCapMs, sleep, random, log.
//
// Retry policy: up to 2 retries on a network error, a timeout, or HTTP
// 408/425/429/5xx; never on any other status (a 404 is an answer, not a
// hiccup) and never on a JSON parse error (the same bytes would come back).
// Backoff 1 s then 3 s, +-25% jitter; a Retry-After header (seconds or an HTTP
// date) replaces the backoff, capped at 30 s. The error a caller finally sees
// is the last attempt's own error ("HTTP 503", "The operation was aborted due
// to timeout", ...), so the noteFailure ledger in fetch.mjs reads as before.
// A request that succeeded after a retry is not a failure; it logs one
// `retry` line and is counted in retryReport().
//
// Time: the deadline uses performance.now(), never Date: the replay harness
// freezes Date, and a frozen clock would make the deadline never arrive.
// Node 18.19 compatible: no AbortSignal.any, no dependencies.
import { setMaxListeners } from "node:events";
import { performance } from "node:perf_hooks";

export class DeadlineError extends Error {
  constructor(message = "global fetch deadline exceeded") {
    super(message);
    this.name = "DeadlineError";
  }
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

const RETRYABLE_STATUS = (s) => s === 408 || s === 425 || s === 429 || (s >= 500 && s <= 599);
const DEFAULTS = {
  retries: 2,
  backoffMs: [1000, 3000],
  jitter: 0.25,
  retryAfterCapMs: 30000,
};

// ---- global deadline -------------------------------------------------------
let dl = null; // { endsAt, ctl, timer, expired, ms }

export function startDeadline(ms, { onExpire } = {}) {
  stopDeadline();
  if (!(Number.isFinite(ms) && ms > 0)) return;
  const ctl = new AbortController();
  setMaxListeners(0, ctl.signal); // one listener per in-flight request
  const state = { endsAt: performance.now() + ms, ctl, timer: null, expired: false, ms, onExpire: onExpire || defaultOnExpire };
  dl = state;
  state.timer = setTimeout(() => expire(state), ms);
  if (state.timer && typeof state.timer.unref === "function") state.timer.unref();
}

export function stopDeadline() {
  if (!dl) return;
  clearTimeout(dl.timer);
  dl = null;
}

// Runs once, from the timer or from the first call that finds the time already
// spent (synchronous work, e.g. a curl HEAD, can hold the timer back), so the
// run always ends the same way: exit 124, one line, nothing written.
function expire(state) {
  if (state.expired) return;
  state.expired = true;
  clearTimeout(state.timer);
  state.ctl.abort(new DeadlineError());
  state.onExpire(state.ms);
}

function defaultOnExpire(ms) {
  // One line, then out: the output file is written only at the very end of
  // main(), after stopDeadline(), so exiting here can never publish a partial
  // feed. 124 is what coreutils `timeout` uses, so build-site.sh reads both
  // the same way.
  process.stderr.write(`FATAL: global fetch deadline of ${ms} ms exceeded (FETCH_DEADLINE_MS); exiting 124 without writing output\n`);
  process.exit(124);
}

function deadlineLeft() {
  if (!dl) return Infinity;
  if (dl.expired) return 0;
  return Math.max(0, dl.endsAt - performance.now());
}

function checkDeadline() {
  if (!dl) return;
  if (!dl.expired && deadlineLeft() <= 0) expire(dl);
  if (dl && dl.expired) throw new DeadlineError();
}

// ---- retry accounting --------------------------------------------------------
const retried = new Map(); // url -> retries spent on it (summed across calls)
let retryTotal = 0;

export function retryStats() {
  return { urls: retried.size, retries: retryTotal };
}

export function retryReport() {
  if (!retryTotal) return "";
  return `  ${retryTotal} retr${retryTotal === 1 ? "y" : "ies"} across ${retried.size} URL(s); see the "retry:" lines above`;
}

// Test helper: reset counters between cases.
export function _resetRetryStats() {
  retried.clear();
  retryTotal = 0;
}

// ---- helpers ---------------------------------------------------------------------
function parseRetryAfter(value, nowMs) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.max(0, t - nowMs);
}
export { parseRetryAfter as _parseRetryAfter };

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A per-attempt signal: the attempt's own timeout, plus the global deadline.
function attemptSignal(timeoutMs) {
  const t = AbortSignal.timeout(timeoutMs);
  if (!dl) return { signal: t, done() {} };
  const d = dl.ctl.signal;
  const ac = new AbortController();
  const onT = () => ac.abort(t.reason);
  const onD = () => ac.abort(d.reason);
  t.addEventListener("abort", onT, { once: true });
  d.addEventListener("abort", onD, { once: true });
  return {
    signal: ac.signal,
    done() {
      t.removeEventListener("abort", onT);
      d.removeEventListener("abort", onD);
    },
  };
}

const shortWhy = (e) => String((e && e.message) || e).replace(/\s+/g, " ").trim().slice(0, 60);

// ---- core ------------------------------------------------------------------------
async function request(url, opts, defaultTimeoutMs) {
  const o = { ...DEFAULTS, ...opts };
  const timeoutMs = o.timeoutMs || defaultTimeoutMs;
  const sleep = o.sleep || realSleep;
  const random = o.random || Math.random;
  const log = o.log || ((line) => console.log(line));
  const whys = [];

  for (let attempt = 0; ; attempt++) {
    checkDeadline();
    let err;
    let retryAfterMs = null;
    const sig = attemptSignal(timeoutMs);
    try {
      const init = { signal: sig.signal };
      if (o.headers) init.headers = o.headers;
      const res = await globalThis.fetch(url, init);
      if (res.ok) {
        const body = await res.text();
        if (attempt) noteRetried(url, attempt, whys, "ok", log);
        return { body, status: res.status, headers: res.headers, url: res.url };
      }
      err = new HttpError(res.status, url);
      if (res.body) await res.body.cancel().catch(() => {});
      if (!RETRYABLE_STATUS(res.status)) throw err;
      retryAfterMs = parseRetryAfter(res.headers.get("retry-after"), Date.now());
    } catch (e) {
      if (dl && dl.expired) throw new DeadlineError();
      if (e instanceof HttpError && !RETRYABLE_STATUS(e.status)) {
        if (attempt) noteRetried(url, attempt, whys, e.message, log);
        throw e;
      }
      err = e;
    } finally {
      sig.done();
    }

    whys.push(shortWhy(err));
    if (attempt >= o.retries) {
      if (attempt) noteRetried(url, attempt, whys, "failed", log);
      throw err;
    }
    let wait;
    if (retryAfterMs != null) {
      wait = Math.min(retryAfterMs, o.retryAfterCapMs);
    } else {
      const base = o.backoffMs[Math.min(attempt, o.backoffMs.length - 1)];
      wait = Math.max(0, Math.round(base * (1 + (random() * 2 - 1) * o.jitter)));
    }
    // Waiting past the deadline is pointless: fail now, not in 3 s.
    // (This one call fails; the run itself still ends at the deadline.)
    if (wait >= deadlineLeft()) throw new DeadlineError("retry backoff would outlast the global fetch deadline");
    await sleep(wait);
  }
}

function noteRetried(url, retries, whys, outcome, log) {
  retried.set(url, (retried.get(url) || 0) + retries);
  retryTotal += retries;
  log(`  retry: ${retries}x (${whys.join("; ")}) -> ${outcome}  ${String(url).slice(0, 120)}`);
}

export async function getText(url, opts = {}) {
  const r = await request(url, opts, 30000);
  return opts.withMeta ? { data: r.body, status: r.status, headers: r.headers, url: r.url } : r.body;
}

export async function getJson(url, opts = {}) {
  const r = await request(url, opts, 20000);
  const data = JSON.parse(r.body); // a parse error is not retried
  return opts.withMeta ? { data, status: r.status, headers: r.headers, url: r.url } : data;
}

// Read-only view of the deadline, for logs/tests.
export const deadline = {
  get active() { return !!dl; },
  get expired() { return !!(dl && dl.expired); },
  get remainingMs() { return deadlineLeft(); },
};
