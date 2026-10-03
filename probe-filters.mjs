// Inspect the ACTUAL shape of the filter controls before asserting anything
// about them. The previous version assumed `#f-hood` was a <select> and threw
// `sel.options is not iterable` — I had read `id="f-hood"` in the source and
// filled in the rest. This dumps what is really there.
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
  const r = { groups: [], selectCount: 0, chipButtonCount: 0, sampleChip: null };

  document.querySelectorAll("select").forEach((s) => r.selectCount++);

  // Every .fgroup, with its label and the control tag names it actually contains
  document.querySelectorAll(".fgroup").forEach((g) => {
    const label = g.querySelector(".flabel");
    const kids = [...g.querySelectorAll("*")]
      .filter((e) => e.matches("select,button,input,a"))
      .map((e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : ""));
    r.groups.push({
      label: label ? label.textContent.trim() : null,
      id: g.id || null,
      controls: [...new Set(kids)],
    });
  });

  // What does a chip look like? Grab one and its computed rest/hover style.
  const chip = document.querySelector(".chips button, .chips .chip");
  if (chip) {
    r.chipButtonCount = document.querySelectorAll(".chips button").length;
    const cs = getComputedStyle(chip);
    r.sampleChip = {
      tag: chip.tagName.toLowerCase(),
      cls: chip.className,
      text: chip.textContent.trim().slice(0, 30),
      dataset: { ...chip.dataset },
      display: cs.display,
      borderBottomStyle: cs.borderBottomStyle,
    };
  }

  // Which ids exist at all? This is the ground truth I should have read first.
  r.allFilterIds = [...document.querySelectorAll("[id^=f-]")].map(
    (e) => e.tagName.toLowerCase() + "#" + e.id,
  );

  r.rowCount = document.querySelectorAll(".row").length;
  return r;
});

await b.close();
console.log(JSON.stringify(out, null, 2));