
import { chromium } from "playwright";
const targets = [
  ["kennedy","https://www.kennedy-center.org/whats-on/"],
  ["loc","https://www.loc.gov/events/"],
  ["hirshhorn","https://hirshhorn.si.edu/events/"],
  ["si","https://www.si.edu/whats-on"],
];
const b = await chromium.launch({executablePath: process.env.CHROME_BIN||"/usr/bin/google-chrome", args:["--no-sandbox","--disable-dev-shm-usage"]});
for (const [n,u] of targets) {
  try {
    const p = await b.newPage();
    const r = await p.goto(u,{waitUntil:"domcontentloaded",timeout:40000});
    const status = r ? r.status() : "nav-null";
    const html = await p.content();
    const ev = (html.match(/"@type"\s*:\s*"?Event/g)||[]).length;
    console.log(JSON.stringify({n, status, len: html.length, ldjson:(html.match(/application\/ld\+json/g)||[]).length, eventTypes: ev}));
  } catch(e) { console.log(JSON.stringify({n, error: String(e).split("\n")[0].slice(0,120)})); }
}
await b.close();
