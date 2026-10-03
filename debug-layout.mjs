// Debug the actual computed styles for the layout issues
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

// 1. Check chip gap
const chipGapInfo = await p.evaluate(() => {
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
  // Also check the computed gap on the container
  const container = document.querySelector(".tags");
  const containerStyle = container ? getComputedStyle(container) : null;
  return {
    gaps,
    containerGap: containerStyle ? containerStyle.gap : null,
    containerDisplay: containerStyle ? containerStyle.display : null,
    containerFlexWrap: containerStyle ? containerStyle.flexWrap : null,
  };
});

// 2. Check price alignment
const priceInfo = await p.evaluate(() => {
  const metas = [...document.querySelectorAll(".meta")].filter(m => m.offsetParent !== null);
  if (!metas.length) return { error: "No .meta found" };
  const meta = metas[0];
  const style = getComputedStyle(meta);
  // Find price elements
  const prices = [...meta.querySelectorAll(".price")].filter(p => p.offsetParent !== null);
  const priceStyle = prices.length ? getComputedStyle(prices[0]) : null;
  return {
    metaDisplay: style.display,
    metaFlexWrap: style.flexWrap,
    metaJustifyContent: style.justifyContent,
    metaAlignItems: style.alignItems,
    priceMarginLeft: priceStyle ? priceStyle.marginLeft : null,
    priceMarginRight: priceStyle ? priceStyle.marginRight : null,
    priceCount: prices.length,
  };
});

// 3. Check time label spacing
const timeInfo = await p.evaluate(() => {
  const times = [...document.querySelectorAll(".time")].filter(t => t.offsetParent !== null);
  if (!times.length) return { error: "No .time found" };
  const first = times[0];
  const text = first.textContent.trim();
  return {
    text,
    hasSpaceBeforeMer: /\d\s+[AP]M/i.test(text),
    merAtEnd: /[AP]M$/.test(text),
    // Check each child node
    childNodes: Array.from(first.childNodes).map((node, idx) => ({
      idx,
      type: node.nodeType,
      text: node.nodeType === 3 ? node.textContent.trim() : null,
      tagName: node.nodeType === 1 ? node.tagName : null,
      className: node.nodeType === 1 ? node.className : null,
    })),
  };
});

await b.close();
console.log(JSON.stringify({
  chipGap: chipGapInfo,
  price: priceInfo,
  time: timeInfo
}, null, 2));