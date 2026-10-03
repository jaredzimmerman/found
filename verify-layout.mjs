// Verify the three layout fixes:
// 1. Chip gap is 5px between adjacent chips
// 2. Chip border radius is 1px
// 3. Price is right-aligned in the meta row (on desktop)
// 4. Time label has no space before AM/PM
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

const results = {};

// 1. Chip gap and corner radius
results.chip = await p.evaluate(() => {
  const chips = [...document.querySelectorAll(".chip")].filter(c => c.offsetParent !== null);
  if (chips.length < 2) return { error: "Not enough chips" };
  let gaps = [];
  for (let i = 0; i < chips.length - 1; i++) {
    const a = chips[i].getBoundingClientRect();
    const b = chips[i+1].getBoundingClientRect();
    if (Math.abs(a.top - b.top) < 5) { // same row
      gaps.push(Math.round(b.left - a.right));
    }
  }
  const first = chips[0];
  const style = getComputedStyle(first);
  return {
    gap5: gaps.every(g => g === 5),
    gaps,
    borderRadius: style.borderRadius,
  };
});

// 2. Price alignment: check if price is in .meta and if .meta uses justify-content:space-between
results.price = await p.evaluate(() => {
  const metas = [...document.querySelectorAll(".meta")].filter(m => m.offsetParent !== null);
  if (!metas.length) return { error: "No .meta found" };
  const meta = metas[0];
  const style = getComputedStyle(meta);
  const isFlex = style.display === "flex" || style.display === "inline-flex";
  const justify = style.justifyContent;
  // Check if the last child is a price element
  const lastChild = meta.lastElementChild;
  const isPrice = lastChild && lastChild.classList.contains("price");
  return {
    metaDisplay: style.display,
    justifyContent: justify,
    isFlex,
    lastChildIsPrice: isPrice,
    // Also check if price has margin-left:auto (alternative way)
    priceMarginLeft: isPrice ? getComputedStyle(lastChild).marginLeft : null,
  };
});

// 3. Time label: no space before AM/PM
results.time = await p.evaluate(() => {
  const times = [...document.querySelectorAll(".time")].filter(t => t.offsetParent !== null);
  if (!times.length) return { error: "No .time found" };
  const first = times[0];
  const text = first.textContent.trim();
  return {
    text,
    hasSpaceBeforeMer: /\d\s+[AP]M/i.test(text),
    merAtEnd: /[AP]M$/.test(text),
    // Also check the format: should be like "9:00AM" or "9:00 AM" but we want no space
    // Actually, we removed the space, so it should be "9:00AM"
    matchesNoSpace: /^\d{1,2}:\d{2}[AP]M$/.test(text),
  };
});

await b.close();
console.log(JSON.stringify(results, null, 2));