// Verify the lazy-load fix: every .figure img must reach complete with a real
// natural width, and it must do so within a bounded time.
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});

const samples = [];
for (const ms of [0, 2000, 5000, 10000]) {
  if (ms) await p.waitForTimeout(ms);
  samples.push({
    at: ms,
    ...(await p.evaluate(() => {
      const imgs = [...document.querySelectorAll(".figure img")];
      return {
        inDom: imgs.length,
        complete: imgs.filter((i) => i.complete).length,
        naturalOk: imgs.filter((i) => i.naturalWidth > 0).length,
      };
    })),
  });
}

const final = await p.evaluate(() => {
  const imgs = [...document.querySelectorAll(".figure img")];
  const first = imgs[0];
  return {
    total: imgs.length,
    naturalOk: imgs.filter((i) => i.naturalWidth > 0).length,
    firstSrc: first?.getAttribute("src")?.slice(-36),
    firstComplete: first?.complete,
    firstNatural: first?.naturalWidth,
  };
});

await b.close();
console.log(JSON.stringify({ samples, final }, null, 2));