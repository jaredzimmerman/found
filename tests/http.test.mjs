// Unit tests for build/http.mjs (PLAN C7). Offline: a local node:http server
// on port 0, injected sleep/random so backoff and Retry-After cost no real time.
// Run: node tests/http.test.mjs   (auto-discovered by tests/run-all.sh)
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_MJS = path.join(ROOT, "build", "http.mjs");
const H = await import(pathToFileURL(HTTP_MJS).href);
const { getJson, getText, startDeadline, stopDeadline, DeadlineError, HttpError, retryStats, retryReport, _resetRetryStats, _parseRetryAfter, deadline } = H;

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  -> " + detail : ""}`); }
}
const T0 = Date.now();

// ---- server ------------------------------------------------------------------
const hits = {};
let lastHeaders = null;
const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const n = (hits[p] = (hits[p] || 0) + 1);
  lastHeaders = req.headers;
  const json = (status, obj, extra = {}) => { res.writeHead(status, { "content-type": "application/json", ...extra }); res.end(JSON.stringify(obj)); };
  switch (p) {
    case "/ok": return json(200, { a: 1 }, { "x-wp-totalpages": "7" });
    case "/text": res.writeHead(200, { "content-type": "text/html" }); return res.end("<p>hi</p>");
    case "/bad-json": res.writeHead(200); return res.end("<html>not json");
    case "/flaky": return n === 1 ? json(500, { e: 1 }) : json(200, { ok: n });
    case "/408": return n === 1 ? json(408, {}) : json(200, { ok: n });
    case "/425": return n === 1 ? json(425, {}) : json(200, { ok: n });
    case "/429": return n === 1 ? json(429, {}, { "retry-after": "2" }) : json(200, { ok: n });
    case "/429-date": return n === 1 ? json(429, {}, { "retry-after": new Date(Date.now() + 10000).toUTCString() }) : json(200, { ok: n });
    case "/429-cap": return n === 1 ? json(429, {}, { "retry-after": "120" }) : json(200, { ok: n });
    case "/503": return json(503, {});
    case "/404": return json(404, {});
    case "/403": return json(403, {});
    case "/hang": return; // never answers
    case "/headers": return json(200, { ua: req.headers["user-agent"], accept: req.headers.accept });
    default: return json(404, {});
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const u = (p) => BASE + p;

const delays = [];
const logs = [];
const fast = { sleep: async (ms) => { delays.push(ms); }, random: () => 0.5, log: (l) => logs.push(l) };
const reset = () => { delays.length = 0; logs.length = 0; };
async function err(fn) { try { await fn(); return null; } catch (e) { return e; } }

// ---- success ----------------------------------------------------------------------
reset();
const ok = await getJson(u("/ok"), fast);
check("getJson returns parsed JSON", ok && ok.a === 1);
check("success: one request, no retry log", hits["/ok"] === 1 && logs.length === 0);
const meta = await getJson(u("/ok"), { ...fast, withMeta: true });
check("withMeta exposes response headers (x-wp-totalpages)", meta.data.a === 1 && meta.status === 200 && meta.headers.get("x-wp-totalpages") === "7");
check("getText returns the body text", (await getText(u("/text"), fast)) === "<p>hi</p>");

// ---- headers preserved ------------------------------------------------------------
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Test/1.0";
const hdr = await getJson(u("/headers"), { ...fast, headers: { "User-Agent": UA, Accept: "application/json" } });
check("User-Agent sent exactly as given", hdr.ua === UA, hdr.ua);
check("Accept sent exactly as given", hdr.accept === "application/json", hdr.accept);
await getText(u("/headers"), fast);
check("no headers option: no custom header added (node default UA)", lastHeaders["user-agent"] === "node" || lastHeaders["user-agent"] === "undici", lastHeaders["user-agent"]);

// ---- JSON parse error is not retried --------------------------------------------
reset();
const pe = await err(() => getJson(u("/bad-json"), fast));
check("JSON parse error surfaces as SyntaxError", pe instanceof SyntaxError, String(pe));
check("JSON parse error is not retried (1 request)", hits["/bad-json"] === 1 && delays.length === 0);

// ---- 5xx then 200 -----------------------------------------------------------------------
reset(); _resetRetryStats();
const fl = await getJson(u("/flaky"), fast);
check("500 then 200: succeeds with the 200 body", fl && fl.ok === 2);
check("500 then 200: exactly 2 requests", hits["/flaky"] === 2);
check("500 then 200: first backoff 1 s (jitter centred)", delays.length === 1 && delays[0] === 1000, JSON.stringify(delays));
check("500 then 200: one 'retry:' log line naming the URL and outcome ok", logs.length === 1 && /retry: 1x \(HTTP 500\) -> ok/.test(logs[0]) && logs[0].includes("/flaky"), logs[0]);
check("retry stats count the retried URL", retryStats().urls === 1 && retryStats().retries === 1 && /1 retry across 1 URL/.test(retryReport()), JSON.stringify(retryStats()));

reset();
await getJson(u("/408"), fast); await getJson(u("/425"), fast);
check("408 and 425 are retried", hits["/408"] === 2 && hits["/425"] === 2);

// ---- jitter bounds ------------------------------------------------------------------------
reset();
const e503hi = await err(() => getJson(u("/503"), { ...fast, random: () => 1 }));
check("503 always: 3 requests (2 retries) then the error", hits["/503"] === 3 && e503hi instanceof HttpError && e503hi.message === "HTTP 503" && e503hi.status === 503);
check("backoff 1 s then 3 s, +25% at max jitter", delays.length === 2 && delays[0] === 1250 && delays[1] === 3750, JSON.stringify(delays));
check("exhausted retries log '-> failed'", logs.length === 1 && /retry: 2x \(HTTP 503; HTTP 503; HTTP 503\) -> failed/.test(logs[0]), logs[0]);
reset();
await err(() => getJson(u("/503"), { ...fast, random: () => 0 }));
check("backoff -25% at min jitter", delays[0] === 750 && delays[1] === 2250, JSON.stringify(delays));

// ---- Retry-After -------------------------------------------------------------------------
reset();
const r429 = await getJson(u("/429"), fast);
check("429 with Retry-After: 2 waits 2000 ms then succeeds", r429.ok === 2 && delays.length === 1 && delays[0] === 2000, JSON.stringify(delays));
reset();
await getJson(u("/429-date"), fast);
check("Retry-After as HTTP date honoured (~10 s)", delays.length === 1 && delays[0] > 8000 && delays[0] <= 10000, JSON.stringify(delays));
reset();
await getJson(u("/429-cap"), fast);
check("Retry-After: 120 is capped at 30 s", delays.length === 1 && delays[0] === 30000, JSON.stringify(delays));
check("parseRetryAfter: seconds, date, junk", _parseRetryAfter("3", 0) === 3000 && _parseRetryAfter("Thu, 01 Jan 1970 00:00:05 GMT", 0) === 5000 && _parseRetryAfter("soon", 0) === null && _parseRetryAfter(null, 0) === null);

// ---- non-retryable 4xx ----------------------------------------------------------------------
reset();
const e404 = await err(() => getJson(u("/404"), fast));
check("404 not retried (1 request)", hits["/404"] === 1 && delays.length === 0);
check("404 throws HttpError 'HTTP 404' (noteFailure text unchanged)", e404 instanceof HttpError && e404.message === "HTTP 404" && e404.status === 404);
const e403 = await err(() => getText(u("/403"), fast));
check("403 not retried", hits["/403"] === 1 && e403 instanceof HttpError);

// ---- hang -> timeout -> retried -> final error -------------------------------------------
reset();
const t1 = Date.now();
const eh = await err(() => getText(u("/hang"), { ...fast, timeoutMs: 80 }));
check("hang: every attempt times out, 3 requests", hits["/hang"] === 3, String(hits["/hang"]));
check("hang: final error is the timeout (TimeoutError)", eh && eh.name === "TimeoutError", eh && `${eh.name}: ${eh.message}`);
check("hang: retry line logged with outcome failed", logs.length === 1 && /-> failed/.test(logs[0]) && logs[0].includes("/hang"), logs[0]);
check("hang: per-attempt timeout respected (< 2 s total)", Date.now() - t1 < 2000);

// ---- deadline ----------------------------------------------------------------------------------
reset();
let expiredCalls = 0;
startDeadline(150, { onExpire: () => { expiredCalls++; } });
check("deadline active after startDeadline", deadline.active && !deadline.expired);
const hangBefore = hits["/hang"];
const t2 = Date.now();
const ed = await err(() => getText(u("/hang"), { ...fast, timeoutMs: 5000 }));
check("in-flight request aborted by the deadline with DeadlineError", ed instanceof DeadlineError, String(ed));
check("deadline fired near 150 ms, not the 5 s timeout", Date.now() - t2 < 1500);
check("onExpire called once", expiredCalls === 1);
const okBefore = hits["/ok"];
const ed2 = await err(() => getJson(u("/ok"), fast));
check("after the deadline every call throws DeadlineError at once", ed2 instanceof DeadlineError && hits["/ok"] === okBefore);
check("no request made after the deadline for the hang URL either", hits["/hang"] === hangBefore + 1);
stopDeadline();
check("stopDeadline: calls work again", (await getJson(u("/ok"), fast)).a === 1 && !deadline.active);

// a backoff that would outlive the deadline fails now instead of sleeping
reset();
startDeadline(500, { onExpire: () => {} });
const ed3 = await err(() => getJson(u("/503"), { ...fast, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), backoffMs: [5000] }));
check("backoff longer than the deadline left -> DeadlineError without sleeping", ed3 instanceof DeadlineError && delays.length === 0);
stopDeadline();

// time spent in synchronous work (the timer could not run yet): the next call
// takes the same expire path, so the process still exits 124, not 1
let early = 0;
startDeadline(30, { onExpire: () => { early++; } });
const spinUntil = Date.now() + 60; while (Date.now() < spinUntil) { /* block the loop */ }
const ed4 = await err(() => getJson(u("/ok"), fast));
check("deadline passed during sync work: call throws DeadlineError and onExpire runs once", ed4 instanceof DeadlineError && early === 1 && deadline.expired);
await new Promise((r) => setTimeout(r, 40));
check("timer firing afterwards does not run onExpire twice", early === 1);
stopDeadline();

// real default: the process exits 124 with one stderr line and writes nothing
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "http-test-"));
const outFile = path.join(tmp, "events.json");
const script = `
import { getText, startDeadline, stopDeadline } from ${JSON.stringify(pathToFileURL(HTTP_MJS).href)};
import { writeFileSync } from "node:fs";
startDeadline(100);
await getText(${JSON.stringify(u("/hang"))}, { timeoutMs: 10000 }).catch(() => new Promise(() => {}));
stopDeadline();
writeFileSync(${JSON.stringify(outFile)}, "{}");
`;
const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 4000 });
const errLines = child.stderr.trim().split("\n").filter(Boolean);
check("deadline default: exit code 124", child.status === 124, `status=${child.status} signal=${child.signal} stderr=${child.stderr}`);
check("deadline default: exactly one stderr line naming the deadline", errLines.length === 1 && /deadline/.test(errLines[0]), child.stderr);
check("deadline default: output file never written", !fs.existsSync(outFile));
fs.rmSync(tmp, { recursive: true, force: true });

// unref'd: a finished run is not held open by the deadline timer
const quick = spawnSync(process.execPath, ["--input-type=module", "-e",
  `import { startDeadline } from ${JSON.stringify(pathToFileURL(HTTP_MJS).href)}; startDeadline(60000); console.log("done");`],
  { encoding: "utf8", timeout: 4000 });
check("deadline timer is unref'd (process exits 0 promptly)", quick.status === 0 && quick.stdout.trim() === "done", `status=${quick.status}`);

// ---- teardown ----------------------------------------------------------------------------------
server.closeAllConnections?.();
server.close();
check("whole suite under 5 s", Date.now() - T0 < 5000, `${Date.now() - T0} ms`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
