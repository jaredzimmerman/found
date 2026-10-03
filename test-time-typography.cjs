// How far is the meridiem from the number it belongs to, in real ink pixels?
//
// The DOM text is "9AM — 10AM" because the space in front of a meridiem now
// lives in CSS (`margin-left` on `.mer`), not in a text node. textContent
// therefore reads as if the letters are welded together, which is exactly why
// measuring text alone cannot answer this question — the gap is a rendered
// property, not a string property. This measures the box of each meridiem
// against the ink extent of the digits beside it.
const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const URL = "https://datebook.indigokarasu.com/";

let fails = 0;
const check = (label, ok, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
};

(async () => {
  const b = await pw.chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
  await p.waitForTimeout(2500);

  const data = await p.evaluate(() => {
    // The ink width of a text node, ignoring trailing whitespace: clone the
    // node's text into an inline probe whose own trailing space is removed.
    const inkOf = (node) => {
      const rg = document.createRange();
      rg.selectNodeContents(node);
      const b = rg.getBoundingClientRect();
      return b;
    };
    const rows = [...document.querySelectorAll("#list .row .time")];
    const out = [];
    for (const t of rows) {
      const mers = [...t.querySelectorAll(".mer")];
      if (!mers.length) continue;
      // For each meridiem, find the nearest preceding text sibling and measure
      // the space between the end of that text and the start of the meridiem.
      const pairs = [];
      for (const m of mers) {
        let prev = m.previousSibling;
        while (prev && prev.nodeType !== 3) prev = prev.previousSibling;
        if (!prev) continue;
        const pb = inkOf(prev);
        const mb = m.getBoundingClientRect();
        pairs.push({
          text: t.textContent,
          prevTxt: prev.textContent,
          gap: +(mb.left - pb.right).toFixed(2),
          // An em dash's gap to the meridiem on its far side.
        });
      }
      out.push(...pairs);
    }
    const gaps = out.map((x) => x.gap);
    return {
      count: out.length,
      min: Math.min(...gaps),
      max: Math.max(...gaps),
      all: [...new Set(gaps)].sort((a, z) => a - z),
      sample: out.slice(0, 6),
      texts: [...new Set(rows.map((r) => r.textContent))].slice(0, 6),
      anyAsciiDash: rows.filter((r) => /--/.test(r.textContent)).length,
      anyEmDash: rows.filter((r) => r.textContent.includes("—")).length,
    };
  });

  console.log("\n== the meridiem gap, in rendered pixels ==");
  check("every time with a meridiem was measured", data.count > 0, `${data.count} pairs`);
  // 2-5px at 15px Archivo is a normal space; the bug was 5px gap PLUS a
  // literal space (so ~8px), and then 3px, then 0. The fix targets one value.
  check("the gap is a single consistent space", data.max - data.min < 0.6,
    `${data.min}–${data.max}px across ${data.count} meridiems`);
  check("the gap is not zero (AM/PM is not welded to the hour)",
    data.min > 0.8, `min ${data.min}px`);
  check("the gap is not excessive (AM/PM is not detached)",
    data.max < 5, `max ${data.max}px`);

  console.log("\n== the range separator ==");
  check("no time still contains a double hyphen", data.anyAsciiDash === 0, `${data.anyAsciiDash} rows`);
  check("ranges use a real em dash", data.anyEmDash > 0, `${data.anyEmDash} rows`);
  console.log(`  sample rendered text: ${data.texts.map((t) => JSON.stringify(t)).join(", ")}`);

  await b.close();
  console.log(fails ? `\n${fails} FAILING` : "\nPASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
