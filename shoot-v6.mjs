// Criterion 6 asks for a VISUAL refinement loop: screenshots evaluated for
// type scale, grid alignment, spacing and a11y. Everything so far has been
// geometric assertions, which catch defects but cannot judge a composition.
// Capture the real thing: 3 themes x 2 widths, plus a filter-open and
// filter-closed state, at device pixel ratio 2 so type edges are legible.
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const shots = [];
for (const theme of ["light", "dark", "pink"]) {
  for (const [label, w, h] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    const p = await b.newPage({
      viewport: { width: w, height: h },
      deviceScaleFactor: 2,
    });
    await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await p.evaluate((t) => {
      localStorage.setItem("theme", t);
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    await p.evaluate(() => document.fonts.ready);
    await p.mouse.move(2, 2);
    // Let the halftone ::after and column layout settle before the shot.
    await p.waitForTimeout(1400);
    const f = `shots/v6-${theme}-${label}.png`;
    await p.screenshot({ path: f });
    shots.push(f);
    await p.close();
  }
}

// One state shot per theme with the filter rail OPEN, since "closed by default"
// is a criterion and the open state is the one with all the chips and hairlines
// in it — the busiest thing on the page and the hardest to align.
for (const theme of ["light", "dark", "pink"]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await p.evaluate((t) => {
    localStorage.setItem("theme", t);
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  await p.evaluate(() => document.fonts.ready);
  // Click the real toggle rather than forcing the attribute, so the shot shows
  // what a reader actually gets.
  const opened = await p.evaluate(() => {
    const t = document.querySelector("#ftoggle") || document.querySelector("[aria-controls]");
    if (!t) return false;
    t.click();
    return true;
  });
  await p.waitForTimeout(1000);
  const f = `shots/v6-${theme}-filters-open.png`;
  await p.screenshot({ path: f });
  shots.push(f);
  if (!opened) console.error("WARN: no filter toggle found for", theme);
  await p.close();
}

await b.close();
console.log(shots.join("\n"));
