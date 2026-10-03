// 59 of 72 .figure images stay pending forever, which is the real defect the
// vision model was pointing at. Find out why.
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });

const seen = [];
p.on("request", (r) => {
  if (/assets0\.dostuffmedia\.com/.test(r.url())) seen.push({ u: r.url().slice(-50), m: r.method(), f: r.failure()?.errorText || "" });
});
p.on("response", (r) => {
  if (/assets0\.dostuffmedia\.com/.test(r.url())) seen.push({ u: r.url().slice(-50), s: r.status(), ok: r.ok() });
});

await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
await p.waitForTimeout(8000);

const probe = await p.evaluate(() => {
  const imgs = [...document.querySelectorAll(".figure img")];
  return {
    total: imgs.length,
    complete: imgs.filter((i) => i.complete).length,
    naturalOk: imgs.filter((i) => i.naturalWidth > 0).length,
    // Try to load one by hand and report what happens
    first: imgs[0]
      ? { src: imgs[0].getAttribute("src")?.slice(-40), complete: imgs[0].complete, nat: imgs[0].naturalWidth }
      : null,
  };
});

// Force-load the first image in a fresh tab to isolate the cause
const p2 = await b.newPage();
let manual = "not attempted";
try {
  await p2.goto(probe.first?.src ? probe.first.src : "about:blank", { timeout: 15000 });
  manual = "loaded in fresh tab";
} catch (e) {
  manual = "fresh tab failed: " + e.message;
}
await p2.close();

await b.close();
console.log(JSON.stringify({ requests: seen.slice(0, 12), probe, manual }, null, 2));
