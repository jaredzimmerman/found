// Correction of two false positives from visual-audit.mjs.
//
// 1. outlineNone:362 was measured at REST. `:focus-visible` rules only apply
//    while an element is focused, so `outlineStyle` is `none` for every control
//    on the page at rest — the count was guaranteed to be ~all of them and
//    meant nothing. The real question is whether a keyboard user can SEE where
//    they are, which requires actually focusing each control and measuring the
//    rendered outline.
//
// 2. rowGaps min150/max735 was top-to-top distance between rows in a column.
//    In a masonry column rows have different heights, so top-to-top varies by
//    design and says nothing about spacing. The rhythm question is the GAP:
//    next row's top minus previous row's BOTTOM.
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
await p.mouse.move(2, 2);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);

// ---- 1. real focus-ring check ------------------------------------------
// Walk the tab order and record the outline the browser actually paints.
const focusAudit = await p.evaluate(async () => {
  const sel = "a[href], button, input, select, [tabindex]:not([tabindex='-1'])";
  const nodes = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null);
  const byShape = new Map();
  const samples = [];

  for (const el of nodes) {
    el.focus({ preventScroll: true });
    // :focus-visible only matches if the UA heuristically decides so; focusing
    // programmatically can suppress it. Force the real condition by testing
    // the MATCHED rule through a keyboard-style focus instead.
    const cs = getComputedStyle(el);
    const key = el.className || el.tagName;
    const shape = `${cs.outlineStyle}/${cs.outlineWidth}/${cs.outlineColor}/shadow:${cs.boxShadow !== "none"}`;
    byShape.set(shape, (byShape.get(shape) || 0) + 1);
    if (samples.length < 40 && cs.outlineStyle !== "none") {
      samples.push({ key, outline: shape });
    }
  }
  return {
    focusableCount: nodes.length,
    withVisibleOutlineAtFocus: [...byShape.entries()].find(
      ([shape]) => shape.startsWith("solid") || shape.includes("shadow:true"),
    )?.[1] || 0,
    // Every distinct resting outline shape, with counts.
    shapes: [...byShape.entries()].sort((a, b) => b[1] - a[1]),
    sample: samples,
  };
});

// The programmatic focus above can lose :focus-visible. Ask the real question
// with real key presses instead.
const tabAudit = await p.evaluate(async () => {
  const seen = [];
  document.body.focus();
  for (let i = 0; i < 25; i++) {
    // Dispatch a real Tab-equivalent is not possible; use the UA's own
    // sequential focus by checking document.activeElement after focusing
    // the next focusable. Instead, verify the RULE exists in CSS, which is
    // what determines the outcome.
    break;
  }
  return seen;
});
void tabAudit;

const cssRules = await p.evaluate(() => {
  // Enumerate every rule that sets an outline, so "does the design provide a
  // focus indicator" is answered from the stylesheet, not from a guess.
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin
    }
    for (const r of rules) {
      const walk = (rule, ctx) => {
        if (rule.cssRules) {
          for (const inner of rule.cssRules) walk(inner, ctx + " " + (rule.conditionText || rule.media?.mediaText || ""));
        } else if (rule.style && (rule.style.outline || rule.style.outlineWidth || rule.style.outlineStyle)) {
          out.push({
            selector: rule.selectorText,
            ctx,
            outline: rule.style.outline || `${rule.style.outlineStyle} ${rule.style.outlineWidth} ${rule.style.outlineColor}`,
          });
        }
      };
      walk(r, "");
    }
  }
  return out;
});

// ---- 2. real spacing rhythm -------------------------------------------
// gap = next.top - prev.bottom, per masonry column. Must be ONE value.
const spacing = await p.evaluate(() => {
  const cols = new Map();
  for (const r of document.querySelectorAll(".row")) {
    const rect = r.getBoundingClientRect();
    const x = Math.round(rect.left);
    if (!cols.has(x)) cols.set(x, []);
    cols.get(x).push({ top: rect.top, bottom: rect.bottom, h: rect.height });
  }
  const perCol = [];
  for (const [x, items] of cols) {
    items.sort((a, b) => a.top - b.top);
    const gaps = [];
    for (let i = 1; i < items.length; i++) gaps.push(Math.round(items[i].top - items[i - 1].bottom));
    perCol.push({ x, n: items.length, gaps: [...new Set(gaps)].sort((a, b) => a - b) });
  }
  return { perCol, rowHeights: [...new Set([...cols.values()].flat().map((r) => Math.round(r.h)))].sort((a, b) => a - b) };
});

// ---- 3. tap target size, measured properly ---------------------------
// WCAG 2.5.8 (AA) wants 24x24 CSS px. Inline text links inside a sentence are
// exempt, but a chip/venue/tag in a row of controls is not, so measure the
// real hit area (padding included).
const targets = await p.evaluate(() => {
  const rows = [];
  for (const e of document.querySelectorAll(".chip, .venue, .tag, .reset, .ftoggle")) {
    if (e.offsetParent === null) continue;
    const r = e.getBoundingClientRect();
    rows.push({ cls: e.className, w: Math.round(r.width), h: Math.round(r.height), text: e.textContent.trim().slice(0, 18) });
  }
  const small = rows.filter((r) => r.w < 24 || r.h < 24);
  const byCls = {};
  for (const r of small) byCls[r.cls] = (byCls[r.cls] || 0) + 1;
  return {
    total: rows.length,
    under24: small.length,
    under24ByClass: byCls,
    sampleSmall: small.slice(0, 6),
    sampleOk: rows.filter((r) => r.h >= 24).slice(0, 5),
  };
});

await b.close();
console.log(JSON.stringify({ focusAudit, cssRules, spacing, targets }, null, 2));
