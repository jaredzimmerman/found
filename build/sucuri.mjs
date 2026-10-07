// Solve Sucuri's JS interstitial without a browser.
//
// Sucuri's interstitial is a base64 blob that evaluates to a string and assigns
// it to `document.cookie`, then reloads. It needs three primitives —
// String.fromCharCode, concatenation, and an assignment — and nothing else: no
// DOM, no fetch, no network. So it can be evaluated in plain node and the
// result sent back as a plain Cookie header.
//
// WHY THIS EXISTS: City Lights is behind this challenge, and the only reader in
// fetch.mjs was Playwright. On DreamHost that reader cannot run at all — the
// grsec-hardened shared kernel blocks the Chrome zygote fork and chromium exits
// 133 with an empty DOM — so City Lights contributed ZERO events to the live
// site while the build reported success. This module removes the browser from
// the path entirely, so the source works on any host that can run node 18.
//
// THE TWO THINGS THAT BREAK A SUCURI SOLVER, both hit during development:
//
//   1. The value variable name ROTATES between requests (`d="1"+…` one time,
//      `x='3'+…` the next). It cannot be hardcoded. Hardcoding `d` produced a
//      silent "cookie is undefined" that is indistinguishable from "Sucuri
//      changed the challenge" — it is parsed out of the expression instead.
//
//   2. The cookie NAME is itself assembled from string pieces between the ';'
//      and the '=', so `S='…'` alone is not enough to reconstruct the header.
//
// Both are parsed, never assumed. If the shape ever changes the solve exits
// non-zero with a distinct code and the caller degrades — it never sends a
// half-built header.
//
// SAFETY: the decoded expression is checked against an allowlist of primitives
// and refuses to evaluate anything reaching beyond cookie-setting (fetch,
// XMLHttpRequest, eval, require, process, global access, prototype walks). This
// evaluates code fetched from a third party, so the blast radius is bounded to
// pure string construction before it runs at all.

import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

// curl rather than fetch: it is already the fetch.mjs dependency on this host,
// and it gives the status code and the body in one call with no redirect
// surprises from a challenge page that answers 200.
function curl(url, headers = [], outFile = null) {
  const args = ["-sL", "--max-time", "30", "-A", UA];
  for (const h of headers) args.push("-H", h);
  if (outFile) args.push("-o", outFile);
  args.push("-w", "%{http_code}");
  args.push(url);
  const r = String(execFileSync("curl", args, { encoding: "utf8", maxBuffer: 32 << 20 })).trim();
  return outFile ? { status: parseInt(r, 10), file: outFile } : r;
}

const CHALLENGE_RE = /S='([^']+)'/;
const BANNED =
  /\b(fetch|XMLHttpRequest|eval|Function|require|process|global|globalThis|import|child_process|constructor|__proto__)\b/;

/**
 * Fetch a Sucuri-gated URL and return its real HTML.
 * Returns { html } on success, or { skipped: <reason> } when the page needs no
 * challenge or the challenge shape changed — never a partial answer.
 */
// Async because the vm import is dynamic. A sync function here cannot `await`
// node:vm, and falling back to `require` does not work either — this module is
// ESM, so require is simply not in scope. The caller already awaits.
export async function fetchThroughSucuri(url) {
  const first = curl(url);
  if (!CHALLENGE_RE.test(first)) {
    // No interstitial at all: the plain response IS the page.
    return { html: first };
  }

  const blob = Buffer.from(first.match(CHALLENGE_RE)[1], "base64").toString("utf8");
  const semi = blob.indexOf(";");
  if (semi < 1) return { skipped: "challenge has no statement separator" };
  const expr = blob.slice(0, semi);
  const rest = blob.slice(semi + 1);

  // Rotating variable name — parsed, never hardcoded. See header note 1.
  const vmName = expr.match(/^\s*([A-Za-z_$][\w$]*)\s*=/)?.[1];
  if (!vmName) return { skipped: "challenge shape changed: no value assignment" };

  // Cookie name is concatenated string pieces, not a literal.
  const nameExpr = rest.slice(0, rest.indexOf(";"));
  const cookieName = nameExpr
    .split("=")[1]
    ?.split("+")
    .map((p) => p.trim().replace(/^['"]|['"]$/g, ""))
    .filter((p) => p && !/^String\.fromCharCode$/.test(p))
    .join("");
  if (!cookieName) return { skipped: "challenge shape changed: no cookie name" };

  if (BANNED.test(expr)) return { skipped: "challenge uses a construct outside the allowlist" };

  let cookie = null;
  try {
    // vm must be imported, not required: this module is ESM (fetch.mjs loads it
    // with `await import`), and `require` does not exist in that scope — it
    // would throw ReferenceError and be swallowed as "solve failed" forever.
    const vm = await import("node:vm");
    const ctx = vm.createContext({ String, Object, Array, Math, JSON });
    vm.runInContext(`${expr};`, ctx, { timeout: 1000 });
    const t = vm.runInContext(`typeof ${vmName}`, ctx);
    cookie = t === "string" ? vm.runInContext(vmName, ctx) : null;
  } catch (e) {
    return { skipped: `solve failed: ${e.message.split("\n")[0]}` };
  }
  if (typeof cookie !== "string" || !cookie.length) {
    return { skipped: "solve produced no cookie value" };
  }

  const outFile = join(tmpdir(), `sucuri-solved-${process.pid}.html`);
  try {
    const { status, file } = curl(url, [`Cookie: ${cookieName}=${cookie}`], outFile);
    const html = readFileSync(file, "utf8");
    if (CHALLENGE_RE.test(html)) {
      return { skipped: "still challenged after replay (cookie rejected or rotated)" };
    }
    return { html, status };
  } finally {
    try { unlinkSync(outFile); } catch { /* best effort */ }
  }
}

export const isSucuriChallenge = (body) => CHALLENGE_RE.test(String(body));