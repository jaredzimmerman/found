// Tests build/test-imports.mjs: data-file WARNs (warn-only) and import FAIL (exit 1).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "build", "test-imports.mjs");
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};
const run = (dir) => spawnSync("node", [SCRIPT, dir], { encoding: "utf8", cwd: ROOT });
const warns = (out) => out.split("\n").filter((l) => l.startsWith("WARN "));

// real build tree
const r = run("build");
const w = warns(r.stdout);
check("real build exits 0", r.status === 0, r.stdout);
check("real build prints exactly one WARN", w.length === 1, JSON.stringify(w));
check("WARN is for prices.json", w[0] === "WARN data file not in build tree: prices.json (read by fetch.mjs)", w[0]);
check("prices-resolved.json does not warn", !r.stdout.includes("prices-resolved.json (read by"));
check("venue-catalog.json does not warn", !w.some((l) => l.includes("venue-catalog.json")));

// temp tree: missing data file only -> WARN, exit 0
const tmp = mkdtempSync(join(tmpdir(), "ti-"));
try {
  writeFileSync(join(tmp, "fetch.mjs"),
    'import { readFileSync } from "node:fs";\nimport fs from "node:fs";\n' +
    'readFileSync(new URL("./gone.json", import.meta.url), "utf8");\n' +
    'fs.readFileSync(new URL("./gone2.json", import.meta.url));\n' +
    'readFileSync(new URL("./here.json", import.meta.url));\n');
  writeFileSync(join(tmp, "here.json"), "{}");
  const d = run(tmp);
  const dw = warns(d.stdout);
  check("missing data file: exit 0", d.status === 0, d.stdout);
  check("missing data files warn (gone, gone2)", dw.length === 2 && dw[0].includes("gone.json") && dw[1].includes("gone2.json"), JSON.stringify(dw));
  check("present data file does not warn", !dw.some((l) => l.includes("here.json")));

  // temp tree: missing import -> exit 1
  writeFileSync(join(tmp, "fetch.mjs"), 'import "./nope.mjs";\n');
  const b = run(tmp);
  check("missing import: exit 1", b.status === 1, b.stdout);
  check("missing import reported", b.stdout.includes("nope.mjs"));
} finally { rmSync(tmp, { recursive: true, force: true }); }

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
