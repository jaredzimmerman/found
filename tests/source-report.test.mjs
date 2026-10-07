// C2: the replay run writes a valid source report. Runs the replay with --out and
// checks the sidecar. Skips (exit 0) when no fixtures are present.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(path.join(root, "tests/replay/fixtures/meta.json"))) { console.log("source-report: no replay fixtures, skipped"); process.exit(0); }
const out = mkdtempSync(path.join(tmpdir(), "srcrep-"));
let bad = 0;
const check = (ok, msg) => { if (!ok) { bad++; console.log("FAIL " + msg); } };
try {
  execFileSync("bash", [path.join(root, "tests/replay/run.sh"), "--only", "fetch", "--out", out], { stdio: "pipe" });
  const r = JSON.parse(readFileSync(path.join(out, ".source-report.json"), "utf8"));
  const ev = JSON.parse(readFileSync(path.join(out, "events.normalized.json"), "utf8")).events;
  const names = Object.keys(r.sources);
  const kept = names.reduce((s, n) => s + r.sources[n].kept, 0);
  check(kept === r.totals.kept && kept === ev.length, `sum(kept)=${kept} totals=${r.totals.kept} events=${ev.length}`);
  check(r.sources.omnivore && r.sources.omnivore.status === "skipped", "omnivore is skipped");
  check(names.every((n) => /^[a-z0-9]+$/.test(n)), "names are lower-case");
  for (const n of ["dothebay","funcheap","citylights","foopee","decentered","luma","sfstation","sfcb","workshopsf","clayroom","scrap","espn"])
    check(r.sources[n] && r.sources[n].status === "ok", `${n} present and ok`);
  check(names.every((n) => r.sources[n].kept <= r.sources[n].registered), "kept <= registered");
  check(/sources: \d+ ok, 1 skipped \(omnivore\), 0 failed/.test(readFileSync(path.join(out, "events.log"), "utf8")), "final line lists omnivore as skipped");
  check(!/every source fetch succeeded/.test(readFileSync(path.join(out, "events.log"), "utf8")), "no false success line");
} catch (e) { bad++; console.log("FAIL " + e.message); }
rmSync(out, { recursive: true, force: true });
console.log(bad ? `source-report: ${bad} failure(s)` : "source-report: all checks passed");
process.exit(bad ? 1 : 0);
