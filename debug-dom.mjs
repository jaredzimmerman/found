// Debug: check what's in the DOM
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });

// Set pink theme
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
await p.evaluate(() => {
  document.documentElement.setAttribute("data-theme", "pink");
});
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(2000);

// Check what's in the DOM
const info = await p.evaluate(() => {
  return {
    totalFigures: document.querySelectorAll(".figure").length,
    totalImages: document.querySelectorAll(".figure img").length,
    figuresWithImages: document.querySelectorAll(".figure img[src]").length,
    firstFigure: document.querySelector(".figure") ? {
      hasImg: !!document.querySelector(".figure img"),
      imgSrc: document.querySelector(".figure img")?.getAttribute("src"),
      imgClasses: document.querySelector(".figure img")?.className,
      figureClasses: document.querySelector(".figure")?.className,
    } : null,
    // Check for ::after pseudo-element
    afterExists: !!window.getComputedStyle(document.querySelector(".figure"), "::after"),
    afterStyle: window.getComputedStyle(document.querySelector(".figure"), "::after")?.content,
  };
});

await b.close();
console.log(JSON.stringify(info, null, 2));