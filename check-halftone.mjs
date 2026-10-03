// Check the background color of the images and the halftone effect in the pink theme
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
await p.waitForTimeout(1000);

// Get the background color of the first image and the computed filter
const info = await p.evaluate(() => {
  const img = document.querySelector(".figure img");
  if (!img) return null;
  const style = getComputedStyle(img);
  return {
    backgroundColor: style.backgroundColor,
    filter: style.filter,
    // Also get the computed color of the halftone dots? We can't directly, but we can check the SVG filter's color if it uses CSS variables.
    // The halftone filter is defined in SVG and uses the --ink variable via the CSS variable in the SVG? Let's check.
    // Actually, the SVG filter is defined in the HTML and does not use CSS variables directly. We set the color of the halftone by setting the
    // `flood-color` in the SVG to the theme's ink? Let's look at the SVG definition in the page.
    // We can inline the SVG and check its content.
    svgDefs: document.querySelector("svg#halftone-defs") ? document.querySelector("svg#halftone-defs").outerHTML : null,
  };
});

await b.close();
console.log(JSON.stringify(info, null, 2));