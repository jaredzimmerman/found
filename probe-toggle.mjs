// The chips are in the DOM but not visible => the filter panel is collapsed by
// default on BOTH viewports (criterion 5). Before I can test filtering I must
// open it. Find the control that opens it, by looking rather than guessing.
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
await p.waitForTimeout(400);

const out = await p.evaluate(() => {
  const r = { candidates: [], classes: new Set() };

  // Every class on the page, to find the panel/toggle naming convention.
  document.querySelectorAll("*").forEach((e) => {
    if (typeof e.className === "string") {
      e.className
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => r.classes.add(c));
    }
  });
  r.classList = [...r.classes].filter(
    (c) => /filt|panel|toggle|bar|rail|drawer|chip/i.test(c),
  );

  // Buttons that are NOT chips - one of these is probably the opener.
  r.candidates = [...document.querySelectorAll("button")]
    .filter((b) => !b.classList.contains("chip"))
    .map((b) => {
      const cs = getComputedStyle(b);
      return {
        cls: b.className,
        id: b.id || null,
        text: b.textContent.trim().slice(0, 34),
        ariaExpanded: b.getAttribute("aria-expanded"),
        ariaControls: b.getAttribute("aria-controls"),
        visible: b.offsetParent !== null,
        display: cs.display,
      };
    });

  // The container of the hood chips, walked up - who is its hidden ancestor?
  const chip = document.querySelector("#f-hood button.chip");
  const chain = [];
  let e = chip;
  while (e && e !== document.body) {
    const cs = getComputedStyle(e);
    chain.push({
      tag: e.tagName.toLowerCase(),
      cls: (e.className || "").toString().slice(0, 60),
      id: e.id || null,
      display: cs.display,
      height: Math.round(e.getBoundingClientRect().height),
      overflow: cs.overflow,
      maxHeight: cs.maxHeight,
      hidden: e.hasAttribute("hidden"),
    });
    e = e.parentElement;
  }
  r.ancestorChain = chain;
  return r;
});

await b.close();
console.log(JSON.stringify(out, null, 2));