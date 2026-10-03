// Prove the source emits rows in a window Clayroom actually has sessions.
// The live 3-day window (Oct 2-4) has none: every SF course starts Oct 12+.
// This runs the SAME parser against a window covering Oct 12-18.
import { claySchedules, clayPageText } from "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/clay-standalone.mjs";
import { readFileSync } from "node:fs";
const urls = JSON.parse(readFileSync("/tmp/clay_urls.json","utf8"));
const win = new Set(["2026-10-12","2026-10-13","2026-10-14","2026-10-15","2026-10-16","2026-10-17","2026-10-18"]);
let total=0, inwin=[];
for (const u of urls) {
  const r = await fetch(u,{headers:{"User-Agent":"Mozilla/5.0"}});
  const s = claySchedules(clayPageText(await r.text()));
  total += s.length;
  const hit = s.filter(x=>win.has(x.iso));
  if (hit.length) { inwin.push([u.split("/").pop(), hit]); }
}
console.log(`\n  parsed sessions across all pages: ${total}`);
console.log(`  sessions falling in Oct 12-18:    ${inwin.reduce((a,[,h])=>a+h.length,0)}\n`);
for (const [n,h] of inwin) console.log(`   ${n.slice(0,36).padEnd(38)} ${h.map(x=>x.iso.slice(5)+" "+x.label).join("  ")}`);
