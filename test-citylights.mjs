// Test cityLights() on its own, without a 7-minute full scrape behind it.
//
// The full build walks 352 venue calendars, so a mistake in this source costs
// seven minutes to discover. Extract and exercise just this one, against the
// real page, and print exactly what it would contribute.
import { readFileSync, writeFileSync } from "fs";

// Pull cityLights() and the two module-level names it closes over into a
// runnable harness, rather than re-implementing the logic and testing that.
const src = readFileSync(
  "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/fetch.mjs",
  "utf8"
);
const start = src.indexOf("async function cityLights");
const end = src.indexOf("\n// ---------------------------------------------------------------------------\n// Main", start);
if (start < 0 || end < 0) throw new Error("could not locate cityLights() in fetch.mjs");
const fnSrc = src.slice(start, end);

const days = process.argv[2] ? process.argv[2].split(",") : ["2026-09-29", "2026-09-30", "2026-10-01"];

const harness = `
const out = [];
const seen = new Set();
function categorize(a, t, d) { return ["Talks & Workshops"]; }
${fnSrc}
const days = ${JSON.stringify(days)};
await cityLights(days);
console.log("\\n  what it contributes:");
for (const e of out) {
  console.log(\`    \${e.date}  \${e.startMinutes >= 0 ? String(Math.floor(e.startMinutes/60)).padStart(2,"0")+":"+String(e.startMinutes%60).padStart(2,"0") : "--:--"}  \${e.title}\`);
  console.log(\`        url:   \${e.url}\`);
  console.log(\`        price: \${e.priceTier}  tier: \${e.linkTier}\`);
  console.log(\`        blurb: \${(e.description||"").slice(0,90)}\`);
}
console.log(\`\\n  total contributed: \${out.length}\`);
`;
writeFileSync("/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/.cl-harness.mjs", harness);
await import("/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/.cl-harness.mjs");
