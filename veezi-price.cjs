// Veezi serves prices only to a real browser. Read them off the box office page.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const B = {
  "21942": "Black Swan",
  "21943": "Perfect Blue",
  "21944": "Black Swan + Perfect Blue",
  "21455": "D.E.B.S.",
  "22024": "Filipiñana",
};
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const p = await b.newPage();
  for (const [id, name] of Object.entries(B)) {
    const url = `https://ticketing.uswest.veezi.com/purchase/${id}?siteToken=4m48btf3yavn7xjk5yxk6nc40c`;
    try {
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await p.waitForTimeout(4500);
      const out = await p.evaluate(() => {
        const t = document.body.innerText;
        // Prices as the page states them, plus anything in a data attribute.
        const money = [...new Set((t.match(/[$£€]\s?\d+(?:\.\d{2})?/g) || []))];
        const attr = [...document.querySelectorAll("[data-price],[data-amount]")]
          .map((e) => e.getAttribute("data-price") || e.getAttribute("data-amount"));
        return { money: money.slice(0, 8), attr: [...new Set(attr)].slice(0, 8), head: t.slice(0, 180) };
      });
      console.log(`\n${name} (${id})`);
      console.log("  money:", JSON.stringify(out.money), "attr:", JSON.stringify(out.attr));
      console.log("  head :", out.head.replace(/\n+/g, " | ").slice(0, 170));
    } catch (e) {
      console.log(`\n${name} (${id}) ERR ${e.message.slice(0, 90)}`);
    }
  }
  await b.close();
})();
