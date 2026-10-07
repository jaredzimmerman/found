// Import-completeness gate.
//
// A missing module is not a startup error in fetch.mjs: every source is awaited
// inside a try/catch that logs "unavailable — skipped" and moves on. So a file
// absent from build/ does not fail the build, it silently deletes that source
// from the feed — which is how Omnivore has been missing on DreamHost without
// anyone noticing, and how the 19:12 build reported success while contributing
// zero Omnivore rows.
//
// This walks the import graph from fetch.mjs and fails if anything resolves off
// the local filesystem but is not present in build/.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

const BUILD = process.argv[2] || ".";
const ENTRY = resolve(BUILD, "fetch.mjs");

const seen = new Set();
const missing = new Set();
const edges = [];
const missingData = new Map();   // data file name -> first module that reads it

const resolveSpec = (spec, from) => {
  if (!spec.startsWith(".")) return null;               // bare/builtin — not ours
  const p = resolve(dirname(from), spec);
  return existsSync(p) ? p : null;
};

const walk = (file) => {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  const specs = new Set();
  for (const m of src.matchAll(/(?:^|[^\w.])(?:import|export)\s+(?:[^"']*?\sfrom\s+)?["']([^"']+)["']/g)) {
    specs.add(m[1]);
  }
  // Dynamic import() with a literal, which is how the sources load their cores.
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    specs.add(m[1]);
  }
  // Data files read relative to this module: readFileSync/readFile(new URL("./x", import.meta.url)).
  // Warn-only: fetch.mjs guards some of these with try/catch, so a missing one
  // silently disables a feature instead of failing.
  for (const m of src.matchAll(/\breadFile(?:Sync)?\(\s*new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g)) {
    const target = resolve(dirname(file), m[1]);
    if (!existsSync(target) && !missingData.has(m[1])) {
      missingData.set(m[1], relative(resolve(BUILD), file));
    }
  }
  for (const spec of specs) {
    edges.push(`${file.replace(BUILD + "/", "")} -> ${spec}`);
    const r = resolveSpec(spec, file);
    if (!r) {
      if (spec.startsWith(".")) missing.add(`${file.replace(BUILD + "/", "")} imports ${spec} — NOT PRESENT`);
      continue;
    }
    walk(r);
  }
};

walk(ENTRY);

console.log(`import graph from ${ENTRY.replace(process.cwd() + "/", "")}`);
console.log(`  ${seen.size} modules reachable\n`);
for (const e of edges.sort()) console.log("  " + e);

for (const [name, mod] of missingData) {
  console.log(`WARN data file not in build tree: ${name.replace(/^\.\//, "")} (read by ${mod})`);
}

if (missing.size) {
  console.log(`\nFAIL: ${missing.size} unresolved relative import(s)`);
  for (const m of missing) console.log("  - " + m);
  process.exit(1);
}
console.log("\nPASS: every relative import resolves inside the build tree");