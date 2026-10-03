const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const SITE = "https://datebook.indigokarasu.com/";
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await b.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  await page.goto(SITE, { wait_until: "networkidle" });
  await page.waitForSelector("#list .row", { timeout: 20000 });
  await page.screenshot({ path: "/tmp/phone-collapsed.png" });
  await page.click("#ftoggle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/phone-open.png" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/desktop.png" });
  await b.close();
  console.log("shots written");
})();
