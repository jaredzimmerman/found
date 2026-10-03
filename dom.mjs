import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox","--disable-setuid-sandbox"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(() => {
  const counts = {};
  for (const el of document.querySelectorAll("*")) {
    for (const c of (el.className && typeof el.className === "string" ? el.className.split(/\s+/) : [])) {
      if (c) counts[c] = (counts[c] || 0) + 1;
    }
  }
  const articles = [...document.querySelectorAll("article")].slice(0,3).map(a => ({ cls: a.className, kids: [...a.children].map(c => c.tagName.toLowerCase()+"."+c.className) }));
  return { counts, articles, rowCount: document.querySelectorAll(".row").length, h3: document.querySelectorAll("h3").length };
}), null, 2));
await b.close();
