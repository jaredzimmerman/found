const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto("https://datebook.indigokarasu.com/?cb=" + Date.now(), { waitUntil: "networkidle" });
  await p.waitForSelector("#list .row", { timeout: 20000 });
  console.log(JSON.stringify(await p.evaluate(() => {
    const l = document.querySelector(".day-list");
    const out = { inlineStyle: l.getAttribute("style"), layerRules: [], supportsRules: [], sheets: [] };
    for (const sheet of document.styleSheets) {
      let rs; try { rs = sheet.cssRules; } catch (e) { out.sheets.push("CORS:" + e.message); continue; }
      out.sheets.push({ href: sheet.href, rules: rs.length, ownerTag: sheet.ownerNode && sheet.ownerNode.tagName });
      const walk = (list, path) => {
        for (const r of list) {
          if (r.type === CSSRule.MEDIA_RULE) walk(r.cssRules, path + "@media " + r.conditionText);
          else if (r.type === CSSRule.SUPPORTS_RULE) walk(r.cssRules, path + "@supports");
          else if (r.cssRules) walk(r.cssRules, path + "@layer/other");
          if (r.selectorText && /day-list/.test(r.selectorText) && /column/.test(r.style.cssText))
            out.layerRules.push({ path, sel: r.selectorText, body: r.style.cssText, important: r.style.getPropertyPriority("column-count") });
        }
      };
      walk(rs, "");
    }
    // Does the element actually get the declaration if we re-apply it?
    const before = getComputedStyle(l).columnCount;
    l.style.columnCount = "3";
    const after = getComputedStyle(l).columnCount;
    l.style.columnCount = "";
    return { ...out, computed: before, afterForced: after, sameNodeReRules: document.querySelectorAll(".day-list").length };
  }), null, 1));
  await b.close();
})();
