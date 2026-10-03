const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = [];
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  p.on("pageerror", (e) => errs.push("PAGEERROR " + String(e).slice(0, 200)));

  await p.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
  await p.waitForSelector(".row", { timeout: 25000 });
  await p.waitForTimeout(1500);

  const st = await p.evaluate(() => {
    const dayLists = [...document.querySelectorAll(".day-list")];
    return {
      rows: document.querySelectorAll(".row").length,
      figures: document.querySelectorAll(".figure").length,
      dayLists: dayLists.length,
      perDay: dayLists.map((d) => d.querySelectorAll(".row").length),
      dayHeads: [...document.querySelectorAll(".day-head, .day")].map((h) => ({
        cls: h.className, txt: (h.textContent || "").trim().slice(0, 40),
      })),
      // Masonry: how many distinct x-origins?
      colX: [...new Set([...document.querySelectorAll(".row")]
        .map((r) => Math.round(r.getBoundingClientRect().left / 20) * 20))].sort((a, b) => a - b),
      // Any row with display:none or zero height?
      hiddenRows: [...document.querySelectorAll(".row")]
        .filter((r) => r.offsetParent === null).length,
      bodyText: document.body.innerText.slice(0, 300),
    };
  });
  console.log(JSON.stringify(st, null, 1));
  console.log("ERRORS:", errs.length, errs.slice(0, 5).join(" | "));
  await b.close();
})();
