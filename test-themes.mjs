// Test that the three themes (light, dark, pink) are working correctly
// by checking that the CSS variables resolve to the expected values
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

// Test each theme
const themes = [
  { name: "light", dataTheme: null }, // no attribute = light (default)
  { name: "dark", dataTheme: "dark" },
  { name: "pink", dataTheme: "pink" }
];

const results = {};

for (const {name, dataTheme} of themes) {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  
  // Set the theme via data-theme attribute on <html>
  await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  
  if (dataTheme) {
    await p.evaluate((theme) => {
      document.documentElement.setAttribute("data-theme", theme);
    }, dataTheme);
  }
  
  // Wait for fonts and initial paint
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1000);
  
  // Extract the computed values of key CSS variables
  const vars = await p.evaluate(() => {
    const get = (varName) => {
      return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    };
    return {
      "--ink": get("--ink"),
      "--paper": get("--paper"),
      "--accent": get("--accent"),
      "--dot-r": get("--dot-r"),
      "--dot-cell": get("--dot-cell"),
      "--fibre": get("--fibre"),
      "--shadow": get("--shadow"),
    };
  });
  
  results[name] = vars;
  await p.close();
}

await b.close();
console.log(JSON.stringify(results, null, 2));