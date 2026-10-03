// Get the innerHTML of the time element to see what's actually rendered
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });

await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1000);

const innerHTML = await p.evaluate(() => {
  const time = document.querySelector(".time");
  return time ? time.innerHTML : null;
});

const outerHTML = await p.evaluate(() => {
  const time = document.querySelector(".time");
  return time ? time.outerHTML : null;
});

const textContent = await p.evaluate(() => {
  const time = document.querySelector(".time");
  return time ? time.textContent : null;
});

await b.close();
console.log(JSON.stringify({
  innerHTML,
  outerHTML,
  textContent
}, null, 2));