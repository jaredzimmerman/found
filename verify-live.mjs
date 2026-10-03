// Verify all three changes on the live site
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
await p.waitForTimeout(1500);

const out = {};

// 1. Price right-aligned on desktop (margin-left:auto on .price)
out.priceAlign = await p.evaluate(() => {
  const prices = [...document.querySelectorAll(".price")].filter(e => e.offsetParent !== null);
  if (!prices.length) return { found: false };
  const first = prices[0];
  const style = getComputedStyle(first);
  const rect = first.getBoundingClientRect();
  const rowRect = first.closest(".row")?.getBoundingClientRect() || { right: 0 };
  return {
    found: true,
    marginLeft: style.marginLeft,
    marginRight: style.marginRight,
    leftOfRow: Math.round(rect.left - rowRect.left),
    rightOfRow: Math.round(rowRect.right - rect.right),
    atRightEdge: Math.abs(rowRect.right - rect.right) < 30,
    priceText: first.textContent.trim(),
  };
});

// 2. Time label: no space before AM/PM
out.timeLabel = await p.evaluate(() => {
  const times = [...document.querySelectorAll(".time")].filter(e => e.offsetParent !== null);
  if (!times.length) return { found: false };
  const first = times[0];
  const text = first.textContent.trim();
  return {
    found: true,
    text,
    hasSpaceBeforeMer: /\d\s+[AP]M/i.test(text),
    merAtEnd: /[AP]M$/.test(text),
  };
});

// 3. Chip gap: 5px between adjacent chips
out.chipGap = await p.evaluate(() => {
  const chips = [...document.querySelectorAll(".tags .chip, .chips .chip")].filter(e => e.offsetParent !== null);
  if (chips.length < 2) return { found: false };
  let gaps = [];
  for (let i = 0; i < chips.length - 1; i++) {
    const a = chips[i].getBoundingClientRect();
    const b = chips[i+1].getBoundingClientRect();
    if (Math.abs(a.top - b.top) < 5) { // same row
      gaps.push(Math.round(b.left - a.right));
    }
  }
  return {
    found: true,
    gaps,
    all5: gaps.every(g => g === 5),
  };
});

// 4. Chip corner radius
out.chipRadius = await p.evaluate(() => {
  const chip = document.querySelector(".chip");
  if (!chip) return { found: false };
  return {
    found: true,
    borderRadius: getComputedStyle(chip).borderRadius,
  };
});

// 5. Image corner radius
out.imageRadius = await p.evaluate(() => {
  const img = document.querySelector(".figure img");
  if (!img) return { found: false };
  return {
    found: true,
    borderRadius: getComputedStyle(img).borderRadius,
  };
});

await b.close();
console.log(JSON.stringify(out, null, 2));
