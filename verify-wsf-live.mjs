// The feed fix and the feed are two different claims. This renders the live
// page and reads the actual Workshop SF card text, so "3 events published" is
// proved at the point of delivery rather than in the JSON.
import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);

console.log(JSON.stringify(await p.evaluate(() => {
  const cards = [...document.querySelectorAll("article.row")].filter((e) => e.offsetParent !== null);
  const wsf = cards.filter((c) => /workshop sf/i.test(c.textContent || ""));
  return {
    totalCards: cards.length,
    workshopCards: wsf.length,
    cards: wsf.map((c) => {
      const a = c.querySelector("a[href]");
      return {
        title: (c.querySelector(".title-e") || c.querySelector("h3"))?.textContent.trim().slice(0, 70),
        venue: c.querySelector("button.venue")?.textContent.trim(),
        time: c.querySelector(".time")?.textContent.trim(),
        href: a ? a.getAttribute("href") : null,
        isDirectClassPage: a ? /workshopsf\.org\/class\//.test(a.getAttribute("href") || "") : false,
      };
    }),
  };
}), null, 2));
await b.close();
