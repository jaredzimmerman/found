#!/usr/bin/env node
// Compare a scraper feed against its golden file (PLAN C10).
//
//   node compare.mjs --normalize IN.json OUT.json   # write the normalized form
//   node compare.mjs GOLDEN.json ACTUAL.json        # report differences
//
// Normalization drops `generatedAt` (the only field allowed to differ between
// runs) and re-serializes with 2-space indentation, so two normalized outputs
// of the same run are byte-identical. The comparison is semantic, not a raw
// diff: it lists added / removed / changed event ids with per-field changes,
// envelope changes (days, counts, neighborhoods, ...) and an order change.
// Exit 0 = identical, 1 = any difference, 2 = usage / unreadable input.
import { readFileSync, writeFileSync } from "node:fs";

const IGNORED_TOP = new Set(["generatedAt"]);

export function normalize(feed) {
  const out = {};
  for (const [k, v] of Object.entries(feed)) if (!IGNORED_TOP.has(k)) out[k] = v;
  return out;
}
export const serialize = (feed) => JSON.stringify(normalize(feed), null, 2) + "\n";

const show = (v) => {
  const s = JSON.stringify(v);
  return s === undefined ? "(absent)" : s.length > 140 ? s.slice(0, 137) + "..." : s;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Events keyed by id; a repeated id gets a #n suffix so duplicates are compared
// positionally instead of silently collapsing.
function byId(events) {
  const m = new Map();
  const n = new Map();
  for (const e of events || []) {
    const id = String(e && e.id);
    const k = n.has(id) ? `${id}#${n.get(id) + 1}` : id;
    n.set(id, (n.get(id) || 0) + 1);
    m.set(k, e);
  }
  return m;
}

export function compare(golden, actual) {
  const lines = [];
  const g = normalize(golden);
  const a = normalize(actual);

  for (const k of new Set([...Object.keys(g), ...Object.keys(a)])) {
    if (k === "events") continue;
    if (!same(g[k], a[k])) lines.push(`envelope ${k}: ${show(g[k])} -> ${show(a[k])}`);
  }

  const ge = byId(g.events);
  const ae = byId(a.events);
  const added = [...ae.keys()].filter((k) => !ge.has(k));
  const removed = [...ge.keys()].filter((k) => !ae.has(k));
  const changed = [];
  for (const [k, ev] of ge) {
    if (!ae.has(k)) continue;
    const av = ae.get(k);
    if (same(ev, av)) continue;
    const fields = [];
    for (const f of new Set([...Object.keys(ev), ...Object.keys(av)])) {
      if (!same(ev[f], av[f])) fields.push(`    ${f}: ${show(ev[f])} -> ${show(av[f])}`);
    }
    if (!fields.length) fields.push("    (key order changed)");
    changed.push(`  ~ ${k}\n${fields.join("\n")}`);
  }

  if (added.length) lines.push(`added ${added.length} event(s):\n${added.map((k) => `  + ${k}  ${show(ae.get(k).title)} ${ae.get(k).date || ""}`).join("\n")}`);
  if (removed.length) lines.push(`removed ${removed.length} event(s):\n${removed.map((k) => `  - ${k}  ${show(ge.get(k).title)} ${ge.get(k).date || ""}`).join("\n")}`);
  if (changed.length) lines.push(`changed ${changed.length} event(s):\n${changed.join("\n")}`);

  if (!added.length && !removed.length && !changed.length) {
    const go = [...ge.keys()].join("\n");
    const ao = [...ae.keys()].join("\n");
    if (go !== ao) {
      const ga = [...ge.keys()];
      const aa = [...ae.keys()];
      const i = ga.findIndex((k, j) => k !== aa[j]);
      lines.push(`event order changed (first difference at index ${i}: ${ga[i]} -> ${aa[i]})`);
    }
  }

  // Last line of defence: anything the semantic pass missed (e.g. key order).
  if (!lines.length && serialize(golden) !== serialize(actual)) lines.push("serialized output differs (key order or formatting)");
  return lines;
}

function readJson(f) {
  try { return JSON.parse(readFileSync(f, "utf8")); }
  catch (e) { console.error(`compare: cannot read ${f}: ${e.message}`); process.exit(2); }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("compare.mjs")) {
  const args = process.argv.slice(2);
  if (args[0] === "--normalize" && args.length === 3) {
    writeFileSync(args[2], serialize(readJson(args[1])));
    process.exit(0);
  }
  if (args.length !== 2) {
    console.error("usage: compare.mjs GOLDEN ACTUAL | compare.mjs --normalize IN OUT");
    process.exit(2);
  }
  const g = readJson(args[0]);
  const a = readJson(args[1]);
  const diff = compare(g, a);
  if (!diff.length) {
    console.log(`identical: ${(a.events || []).length} events match ${args[0]}`);
    process.exit(0);
  }
  console.log(`DIFFERENT from ${args[0]}:`);
  console.log(diff.join("\n"));
  process.exit(1);
}
