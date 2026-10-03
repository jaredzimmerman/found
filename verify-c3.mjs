// Criterion 3, tested honestly.
//
// The earlier run proved nothing: in SoMa every event type had at least one
// event, so `hiddenTypeValues` was empty and the zero-result path never ran. It
// also showed the neighborhood chips still reading their ORIGINAL counts
// (Mission 21) after a type was stacked on top — which would mean a chip is
// still offered for a combination that yields nothing.
//
// The decisive test: for every chip currently on screen, actually click it and
// check whether any rows come back. A chip that yields zero must not be there.
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
await p.click(".ftoggle");
await p.waitForTimeout(300);

const rows = () => p.evaluate(() => document.querySelectorAll(".row").length);
const chipList = (id) =>
  p.evaluate(
    (gid) =>
      [...document.querySelectorAll("#" + gid + " button.chip")].map((c) => ({
        v: c.dataset.value,
        text: c.textContent.trim(),
      })),
    id,
  );

const out = {};

// Seed with the RAREST type chip by its own count label, whatever that turns
// out to be. Hard-coding a pattern like /\b1$/ found nothing on this run — the
// feed changes daily, so "Books1" existed yesterday and not today. Read the
// counts and pick the minimum instead of assuming a value.
const typeChips = await chipList("f-type");
out.allTypeChips = typeChips;
const withCounts = typeChips
  .map((c) => ({ ...c, n: Number((c.text.match(/(\d+)\s*$/) || [])[1] ?? NaN) }))
  .filter((c) => Number.isFinite(c.n) && c.v !== "")
  .sort((a, b) => a.n - b.n);
out.rareType = withCounts[0] || null;
const rare = out.rareType;
if (rare) {
  await p.click(`#f-type button.chip[data-value="${rare.v}"]`);
  await p.waitForTimeout(300);
  out.rowsWithRareType = await rows();

  // Now enumerate every visible chip in every group and click each one on a
  // FRESH copy of that state, recording whether it produced rows.
  const groups = ["f-day", "f-type", "f-price", "f-sold", "f-hood", "f-link"];
  out.deadChips = [];
  out.liveChips = 0;

  for (const g of groups) {
    const chips = await chipList(g);
    for (const c of chips) {
      // A chip with no data-value is a different kind of control (the
      // "show sold out" toggle, most likely) — clicking it by data-value would
      // build the selector `data-value="undefined"` and time out. Record it and
      // move on rather than aborting the sweep.
      if (c.v === "" || c.v === undefined) {
        out.nonValueChips = out.nonValueChips || [];
        out.nonValueChips.push({ group: g, text: c.text });
        continue;
      }

      // Skip the active ones — clicking a selected chip toggles it OFF.
      // One object argument, not two: `page.evaluate` takes a single argument
      // and throws "Too many arguments" on a bare second one.
      const active = await p.evaluate(
        ({ gid, v }) =>
          document
            .querySelector(`#${gid} button.chip[data-value="${v}"]`)
            ?.getAttribute("aria-pressed") === "true",
        { gid: g, v: c.v },
      );
      if (active) continue;

      const before = await rows();
      await p.click(`#${g} button.chip[data-value="${c.v}"]`);
      await p.waitForTimeout(220);
      const after = await rows();

      if (after === 0 && c.v !== "") {
        out.deadChips.push({ group: g, ...c, produced: after });
      } else {
        out.liveChips++;
      }

      // Toggle back off.
      await p.click(`#${g} button.chip[data-value="${c.v}"]`);
      await p.waitForTimeout(180);
      const restored = await rows();
      if (restored !== before) {
        out.togglleAnomaly = { group: g, chip: c.v, before, after, restored };
      }
    }
  }
}

// Criterion 5 restated, measured on a genuinely untouched page.
const ph = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await ph.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
await ph.waitForTimeout(400);
out.desktopUntouched = await ph.evaluate(() => {
  const r = document.getElementById("frow");
  return {
    panelDisplay: getComputedStyle(r).display,
    ariaExpanded: document.querySelector(".ftoggle").getAttribute("aria-expanded"),
  };
});

await b.close();
console.log(JSON.stringify(out, null, 2));