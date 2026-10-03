// The images ARE being requested and served (diag2 showed no failures). So why
// did waitForFunction time out waiting for every .figure img to be complete?
// Measure completion over time, and separately check whether the images are
// even in the DOM at the moment of measurement.
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
for (const [i, ms] of [0, 1000, 3000, 6000, 10000, 20000].entries()) {
  if (ms) await p.waitForTimeout(ms);
  const s = await p.evaluate(() => {
    const imgs = [...document.querySelectorAll(".figure img")];
    return {
      inDom: imgs.length,
      complete: imgs.filter((i) => i.complete).length,
      naturalOk: imgs.filter((i) => i.naturalWidth > 0).length,
    };
  });
  samples.push({ at: ms, ...s });
}

await b.close();
console.log(JSON.stringify(samples, null, 2));
