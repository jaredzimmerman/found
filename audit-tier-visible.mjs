// Is the link tier shown to the READER, or only used for filtering? My summary
// claimed the page labels each link's tier so a fallback is never passed off as
// a venue page. Check the rendered card directly, not the feed.
import { chromium } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(800);

const out = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".row")].filter((r) => r.offsetParent !== null);
  const card = rows[0];
  // Full structural dump of one card, so the tier label — if it exists — is
  // visible rather than inferred.
  const dump = (el, depth = 0) => {
    if (!el || depth > 3) return null;
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className || "(none)",
      text: (el.textContent || "").trim().slice(0, 60),
      title: el.getAttribute?.("title") || null,
      aria: el.getAttribute?.("aria-label") || null,
      children: [...el.children].map((c) => dump(c, depth + 1)).filter(Boolean),
    };
  };
  // Search the whole card for any tier wording.
  const TIERS = /venue site|box office|aggregator|listing/i;
  const tierText = [];
  for (const r of rows.slice(0, 40)) {
    const m = (r.textContent || "").match(TIERS);
    if (m) tierText.push({ title: r.querySelector("h3, .title")?.textContent?.trim().slice(0, 40), match: m[0] });
  }
  return {
    firstCard: dump(card),
    rowsChecked: Math.min(40, rows.length),
    rowsMentioningATier: tierText.length,
    tierMentions: tierText.slice(0, 5),
  };
});

await b.close();
console.log(JSON.stringify(out, null, 2));
