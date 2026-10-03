// curl says /events.json is 200 but the browser gets 404. Log every request
// the page makes, with its exact URL, so the mismatch is visible rather than
// inferred.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("request", (r) => console.log("[req ]", r.method(), r.url()));
  page.on("response", (r) => console.log("[resp]", r.status(), r.url()));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await b.close();
})();
