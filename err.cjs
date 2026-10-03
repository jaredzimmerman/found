// The page swallows the real error into #err and shows a generic line in #list.
// Read #err, and re-run the boot logic in-page so the message is the one the
// reader would actually see.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message, "\n", (e.stack || "").split("\n").slice(1, 5).join("\n")));
  await page.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  console.log(await page.evaluate(async () => {
    const err = document.querySelector("#err");
    const out = { errHidden: err?.hidden, errText: err?.textContent, rows: document.querySelectorAll("#list .row").length };
    // Reproduce the boot fetch here so the rejection reason is visible.
    try {
      const r = await fetch("events.json", { cache: "no-store" });
      out.fetchStatus = r.status;
      const d = await r.json();
      out.generated = d.generatedAt || d.generated_at;
      out.eventCount = (d.events || []).length;
      out.firstKeys = Object.keys((d.events || [])[0] || {});
    } catch (e) { out.fetchErr = e.message; }
    return JSON.stringify(out, null, 2);
  }));
  await b.close();
})();
