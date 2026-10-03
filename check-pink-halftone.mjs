// Get the actual computed styles for the ::after pseudo-element
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

// Get the computed styles for the ::after pseudo-element
const info = await p.evaluate(() => {
  const img = document.querySelector(".figure img");
  if (!img) return { error: "Missing .figure img" };
  
  const afterStyle = window.getComputedStyle(img, "::after");
  
  return {
    // ::after properties (the halftone screen)
    afterContent: afterStyle.content,
    afterDisplay: afterStyle.display,
    afterPosition: afterStyle.position,
    afterTop: afterStyle.top,
    afterRight: afterStyle.right,
    afterBottom: afterStyle.bottom,
    afterLeft: afterStyle.left,
    afterWidth: afterStyle.width,
    afterHeight: afterStyle.height,
    afterBackgroundColor: afterStyle.backgroundColor,
    afterBackgroundImage: afterStyle.backgroundImage,
    afterBackgroundSize: afterStyle.backgroundSize,
    afterMixBlendMode: afterStyle.mixBlendMode,
    afterOpacity: afterStyle.opacity,
    
    // Check if it uses CSS variables
    backgroundImage: afterStyle.backgroundImage,
    usesDotVar: afterStyle.backgroundImage.includes("var(--dot)"),
    usesDotRVar: afterStyle.backgroundImage.includes("var(--dot-r)"),
    usesDotCellVar: afterStyle.backgroundImage.includes("var(--dot-cell)"),
    usesPaperVar: afterStyle.backgroundColor === "rgb(255, 174, 219)" || // #FFAEDB
                  afterStyle.backgroundColor === "rgba(255, 174, 219, 1)" ||
                  afterStyle.backgroundColor.includes("255, 174, 219"),
    
    // Get root variables for comparison
    rootPaper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
    rootDot: getComputedStyle(document.documentElement).getPropertyValue("--dot").trim(),
    rootDotR: getComputedStyle(document.documentElement).getPropertyValue("--dot-r").trim(),
    rootDotCell: getComputedStyle(document.documentElement).getPropertyValue("--dot-cell").trim(),
  };
});

await b.close();
console.log(JSON.stringify(info, null, 2));