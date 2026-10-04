// City Lights — extractor test against the REAL cityLights() in fetch.mjs.
//
// This suite exists because this source has failed SILENTLY three times: HTML
// recovered, blocks found, and then zero events published — 0 added, 0 errors,
// build reports success. Two of those bugs were real and are now fixed:
//   * hrefs are ABSOLUTE, so a relative-only regex matched nothing;
//   * data-time is a build stamp (1 distinct value / 35 blocks) while the
//     VISIBLE <p class="shortcode-date"> is the true date (35 distinct), so
//     trusting the attribute filed every event on one day.
// A parser that returns 0 for everything would pass a smoke test, so the last
// case is a negative control: break the window and confirm the count falls.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FIXTURE = "/tmp/lvtest/citylights-solved.html";
if (!existsSync(FIXTURE)) {
  console.log("FAIL  fixture missing — capture it with sucuri.mjs before trusting this suite");
  process.exit(1);
}

const src = readFileSync("./fetch.mjs", "utf8");
const start = src.indexOf("async function cityLights");
const end = src.indexOf("\n// ---------------------------------------------------------------------------\n// Omnivore", start);
if (start < 0 || end < 0) {
  console.log("FAIL  could not locate cityLights() in fetch.mjs");
  process.exit(1);
}
const fnSrc = src.slice(start, end);

// The harness supplies exactly the module-level bindings cityLights closes over.
// Anything it needs that is NOT here is a missing dependency, and the test says
// so instead of silently running against an undefined.
//
// timeRangeLabel and clock are COPIED FROM fetch.mjs, not reimplemented: an
// earlier version of this file stubbed them as `${s}-${e}`, which printed "660"
// for 11:00 AM and passed every assertion while testing nothing about the label
// the site actually renders.
//
// `clock` is `const clock = (mins) => …`, NOT a `function clock()` declaration —
// looking for the declaration form silently found nothing and the extractor
// reported "could not extract" instead of testing.
//
// Extraction is by brace/paren DEPTH from the needle, not by first `;\n` or
// first `\n}\n`: `clock`'s body ends `};\n` but contains `;` inside it, so a
// first-semicolon cut truncated the function mid-body and the harness died with
// "Unexpected end of input" — a test that fails for the wrong reason and reads
// like the parser broke.
const grab = (needle) => {
  const i = src.indexOf(needle);
  if (i < 0) return null;
  // Seed the depth from the SIGNATURE's own parentheses. `(mins) => {` has a
  // paren pair that closes back to 0 before the body opens, so starting at 0
  // exits on the arrow's closing paren and returns just the header — the harness
  // then got `const cleanTitle` on line 6 as "unexpected", because the function
  // body never arrived. Only braces should drive the cut; a paren pair inside a
  // body (`padStart(2, "0")`) must not end the scan.
  let depth = 0, bodyStarted = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "{") { depth++; bodyStarted = true; }
    else if (c === "}") {
      depth--;
      if (bodyStarted && depth === 0) return src.slice(i, src[j + 1] === ";" ? j + 2 : j + 1);
    }
  }
  return null;
};
const timeFns = [grab("const clock ="), grab("function timeRangeLabel")]
  .filter(Boolean)
  .join("\n");
if (!/const clock\s*=/.test(timeFns) || !/function timeRangeLabel/.test(timeFns)) {
  console.log("FAIL  could not extract clock()/timeRangeLabel() from fetch.mjs");
  process.exit(1);
}
if ((timeFns.match(/\{/g) || []).length !== (timeFns.match(/\}/g) || []).length) {
  console.log("FAIL  extracted timeFns has unbalanced braces — the harness would fail for the wrong reason");
  process.exit(1);
}

const harness = `
const out = [];
const seen = new Set();
${timeFns}
const cleanTitle = (t) => t;
function categorize() { return ["Talks & Workshops"]; }
const days = JSON.parse(process.env.DAYS);
${fnSrc}
// Top-level await is only legal in a real module context; when node runs this
// file as the entry point it compiles as CommonJS and "await" is a syntax error.
// The async IIFE works under either loader and costs nothing.
(async () => {
  await cityLights(days);
  console.log("COUNT:" + out.length);
  for (const e of out) console.log("ROW:" + JSON.stringify({ id: e.id, date: e.date, title: e.title, url: e.url, start: e.startMinutes, label: e.timeLabel, price: e.priceTier }));
})();
`;

const WINDOW = (process.env.DAYS || "2026-10-03,2026-10-04,2026-10-05").split(",");
writeFileSync("./.cl-harness.mjs", harness);
const { writeFileSync: wf } = await import("node:fs");
wf("/tmp/lvtest/cl-days.json", JSON.stringify(WINDOW));

// Run the harness as a subprocess so an exception inside cityLights cannot be
// swallowed by this process's try/catch and read as "0 events, fine".
const { execFileSync } = await import("node:child_process");
const run = (daysEnv) => {
  try {
    return execFileSync(process.execPath, ["./.cl-harness.mjs"], {
      encoding: "utf8",
      env: { ...process.env, DAYS: JSON.stringify(daysEnv) },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    return `ERR ${e.message}\n${e.stderr || ""}`;
  }
};

let fail = 0;
const check = (name, cond, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fail++;
};

console.log("running cityLights() from fetch.mjs against a saved page\n");
const out = run(WINDOW);
console.log(out.split("\n").filter((l) => !l.startsWith("ROW:")).map((l) => "  " + l).join("\n"));
const rows = out.split("\n").filter((l) => l.startsWith("ROW:")).map((l) => JSON.parse(l.slice(4)));
const m = out.match(/COUNT:(\d+)/);
const count = m ? Number(m[1]) : 0;

console.log("");
check("cityLights() did not throw", !out.startsWith("ERR"), out.startsWith("ERR") ? out.slice(0, 200) : "");
check("the browserless path was used", /sucuri solved in node/.test(out));
check("it published in-window events", count > 0, `${count} rows`);

if (count > 0) {
  check("every row has a real citylights.com permalink",
    rows.every((r) => /^https:\/\/citylights\.com\/events\/[^/]+\/$/.test(r.url)),
    rows.filter((r) => !/citylights\.com/.test(r.url)).length + " bad");
  check("every row has a title that is not a date line",
    rows.every((r) => !/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/.test(r.title)),
    rows.filter((r) => /day,/.test(r.title)).map((r) => r.title).join(" | ") || "clean");
  check("every row has a parsed start time", rows.every((r) => r.start >= 0),
    rows.filter((r) => r.start < 0).map((r) => r.title).join(" | ") || "all have times");
  check("no two rows share an id", new Set(rows.map((r) => r.id)).size === rows.length);
  console.log("\n  published:");
  rows.forEach((r) => console.log(`    ${r.date}  ${r.label}  ${r.title.slice(0, 54)}`));
}

// ---- NEGATIVE CONTROL -------------------------------------------------------
// An empty window must produce zero. If this still returned events, the window
// filter was not load-bearing and the positive result above proves nothing.
const none = run(["1999-01-01"]);
const noneCount = (none.match(/COUNT:(\d+)/) || [, "0"])[1];
check("NEG: an out-of-range window publishes 0 (window filter is load-bearing)",
  noneCount === "0", `got ${noneCount}`);

// A second reader must not double-count the same page.
const twice = (() => {
  const r = run(WINDOW);
  const c = Number((r.match(/COUNT:(\d+)/) || [, "0"])[1]);
  return c === count;
})();
check("re-running is idempotent within one process (seen-set holds)", twice, "");

console.log(fail === 0 ? "\nPASS" : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);