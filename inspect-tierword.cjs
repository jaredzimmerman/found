// Which card still contains a tier word, and is it a defect or real content?
// A venue literally named "The Listing" or a description mentioning "box
// office" is legitimate copy — the card is not the badge. This distinguishes
// the two rather than assuming the worst.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto("http://127.0.0.1:8899/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".row", { timeout: 15000 });
  await page.waitForTimeout(600);

  const hits = await page.evaluate(() =>
    [...document.querySelectorAll(".row")]
      .filter((x) => /venue site|box office|listing/i.test(x.textContent || ""))
      .map((x) => {
        const m = x.querySelector(".meta");
        return {
          id: x.dataset.id,
          title: (x.querySelector(".row-title") || {}).textContent?.trim(),
          metaText: m ? m.textContent.trim() : null,
          // Which CHILD of meta matched? Decisive: if it is the venue button or
          // the address span it is copy; the badge was a bare .prov span.
          metaChildren: m
            ? [...m.children].map((c) => `${c.tagName}.${c.className || "-"}:${c.textContent.trim().slice(0, 40)}`)
            : [],
          where: (() => {
            const t = x.textContent || "";
            const i = t.search(/venue site|box office|listing/i);
            return i >= 0 ? t.slice(Math.max(0, i - 70), i + 50) : null;
          })(),
        };
      })
  );

  for (const h of hits) {
    console.log(`\n--- card ${h.id} ---`);
    console.log(`title : ${h.title}`);
    console.log(`meta  : ${JSON.stringify(h.metaText)}`);
    console.log(`meta children: ${JSON.stringify(h.metaChildren, null, 2)}`);
    console.log(`context: ...${h.where}...`);
  }
  if (!hits.length) console.log("no card contains a tier word");
  await browser.close();
})();
