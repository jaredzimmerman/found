// Syntax is clean, so the failure is at runtime. Capture the real error
// instead of guessing: console messages, page errors, and the failed request.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => console.log("[console." + m.type() + "]", m.text()));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message, "\n", (e.stack || "").split("\n").slice(0, 4).join("\n")));
  page.on("requestfailed", (r) => console.log("[reqfail]", r.url(), r.failure()?.errorText));
  page.on("response", (r) => { if (r.status() >= 400) console.log("[http" + r.status() + "]", r.url()); });
  await page.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  console.log("--- resulting DOM ---");
  console.log(await page.evaluate(() => {
    const l = document.querySelector("#list");
    return { listHTML: l ? l.innerHTML.slice(0, 400) : "NO #list", rows: document.querySelectorAll("#list .row").length };
  }));
  await b.close();
})();
