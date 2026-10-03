// Debug chip layout: margin, padding, width, and the container gap
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
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1000);

const chipInfo = await p.evaluate(() => {
  const chips = [...document.querySelectorAll(".chip")].filter(c => c.offsetParent !== null);
  if (chips.length < 2) return { error: "Not enough chips" };
  const first = chips[0];
  const style = getComputedStyle(first);
  // Also get the computed margin and padding as integers
  const marginLeft = parseFloat(style.marginLeft);
  const marginRight = parseFloat(style.marginRight);
  const paddingLeft = parseFloat(style.paddingLeft);
  const paddingRight = parseFloat(style.paddingRight);
  const width = parseFloat(style.width);
  // Check if the chip is flex item? Not needed.
  return {
    marginLeft: `${marginLeft}px`,
    marginRight: `${marginRight}px`,
    paddingLeft: `${paddingLeft}px`,
    paddingRight: `${paddingRight}px`,
    width: `${width}px`,
    // Also check the computed gap on the container
    container: [...document.querySelectorAll(".tags, .chips")].find(c => c.offsetParent !== null),
  };
});

// Get the container's computed gap and display
const containerInfo = await p.evaluate(() => {
  const containers = [...document.querySelectorAll(".tags, .chips")].filter(c => c.offsetParent !== null);
  if (!containers.length) return { error: "No chip container" };
  const container = containers[0];
  const style = getComputedStyle(container);
  return {
    display: style.display,
    flexWrap: style.flexWrap,
    gap: style.gap,
    marginLeft: style.marginLeft,
    marginRight: style.marginRight,
    paddingLeft: style.paddingLeft,
    paddingRight: style.paddingRight,
  };
});

await b.close();
console.log(JSON.stringify({
  chip: chipInfo,
  container: containerInfo
}, null, 2));