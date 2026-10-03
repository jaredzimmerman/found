// The feed loads (200) but #list .row never becomes "visible" to Playwright.
// That is a GEOMETRY problem, not a data problem — a zero-size or clipped box
// counts as not visible. Measure the real boxes instead of waiting on a
// selector that may never satisfy the visibility heuristic.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const box = (s) => {
      const e = document.querySelector(s);
      if (!e) return "ABSENT";
      const r = e.getBoundingClientRect();
      const c = getComputedStyle(e);
      return `L${Math.round(r.left)} R${Math.round(r.right)} T${Math.round(r.top)} H${Math.round(r.height)} disp=${c.display} vis=${c.visibility} op=${c.opacity} ovf=${c.overflow}`;
    };
    return {
      rowCount: document.querySelectorAll("#list .row").length,
      articleCount: document.querySelectorAll("#list article").length,
      listHTMLhead: (document.querySelector("#list")?.innerHTML || "").slice(0, 300),
      list: box("#list"),
      firstRow: box("#list .row"),
      timeCol: box("#list .row .time-col"),
      time: box("#list .row .time"),
      timePrice: box("#list .row .time-price"),
      price: box("#list .row .price"),
      body: box("#list .row > div:last-child"),
      meta: box("#list .row .meta"),
      venue: box("#list .row .venue"),
      title: box("#list .row .title-e"),
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
