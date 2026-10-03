// Which box-office hosts publish a price on the page itself? Probe one URL per
// host and report what is actually readable — no guessing, no scraping of
// someone else's event's price.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");
const feed = JSON.parse(fs.readFileSync(__dirname + "/events.json", "utf8")).events;
const tick = feed.filter((e) => e.priceTier === "ticketed");

// One representative per host.
const byHost = new Map();
for (const e of tick) {
  const h = new URL(e.url).hostname;
  if (!byHost.has(h)) byHost.set(h, e);
}
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const p = await b.newPage();
  for (const [host, e] of byHost) {
    try {
      await p.goto(e.url, { waitUntil: "domcontentloaded", timeout: 40000 });
      await p.waitForTimeout(3500);
      const r = await p.evaluate(() => {
        const t = document.body.innerText;
        const money = [...new Set(t.match(/\$\s?\d+(?:\.\d{2})?(?:\s?-\s?\$\s?\d+(?:\.\d{2})?)?/g) || [])];
        return { money: money.slice(0, 5), wall: /security verification|just a moment|are you a robot|access denied/i.test(t), title: document.title.slice(0, 60) };
      });
      console.log(
        `${host.padEnd(26)} ${r.wall ? "BOTWALL" : "open   "} money=${JSON.stringify(r.money)}  ${r.title}`
      );
    } catch (err) {
      console.log(`${host.padEnd(26)} ERR     ${err.message.slice(0, 60)}`);
    }
  }
  await b.close();
})();
