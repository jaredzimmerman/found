// 86 rows, zero with `:scope > .price`. So every rule anchored on `.row>.price`
// is dead — the element lives somewhere else. Find its real parent chain.
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
await p.mouse.move(2, 2);
await p.waitForTimeout(1000);

const out = await p.evaluate(() => {
  const prices = [...document.querySelectorAll(".price")].filter((e) => e.offsetParent !== null);
  if (!prices.length) return { error: "no .price in DOM" };

  // The ancestry of the first one, with layout metrics at each level.
  const chain = [];
  let n = prices[0];
  while (n && n !== document.body) {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    chain.push({
      tag: n.tagName.toLowerCase(),
      cls: n.className || "(none)",
      parent: n.parentElement ? n.parentElement.tagName.toLowerCase() + "." + (n.parentElement.className || "") : null,
      display: cs.display,
      isFlex: cs.display.includes("flex"),
      justifyContent: cs.justifyContent,
      rect: { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) },
    });
    n = n.parentElement;
  }

  // Is the price right-aligned relative to the CARD (.row), or to its own
  // immediate parent? Compare against both.
  const measures = prices.slice(0, 8).map((pr) => {
    const row = pr.closest(".row");
    const parent = pr.parentElement;
    const rr = row ? row.getBoundingClientRect() : null;
    const prr = pr.getBoundingClientRect();
    const par = parent ? parent.getBoundingClientRect() : null;
    return {
      text: pr.textContent.trim(),
      parentCls: parent ? parent.className : null,
      parentIsRow: parent === row,
      padRightOfParent: par ? Math.round(par.right - prr.right) : null,
      padRightOfRow: rr ? Math.round(rr.right - prr.right) : null,
      padLeftOfParent: par ? Math.round(prr.left - par.left) : null,
    };
  });

  // How many rows have a price at all, at any depth?
  const rows = [...document.querySelectorAll(".row")].filter((r) => r.offsetParent !== null);
  return {
    priceCount: prices.length,
    rowCount: rows.length,
    rowsWithAnyPrice: rows.filter((r) => r.querySelector(".price")).length,
    rowsWithDirectPrice: rows.filter((r) => r.querySelector(":scope > .price")).length,
    chain,
    measures,
  };
});

await b.close();
console.log(JSON.stringify(out, null, 2));
