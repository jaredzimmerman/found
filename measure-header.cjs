// Measure the mobile header region. Vision is unavailable, so instead of
// squinting at a screenshot, measure the boxes: a cramped header shows up as
// a tall block, a wrapped kicker, or elements sitting on top of each other.
const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const SITE = "https://datebook.indigokarasu.com/";

(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(SITE, { wait_until: "networkidle" });
  await page.waitForSelector("#list .row", { timeout: 20000 });

  const m = await page.evaluate(() => {
    const sel = [".masthead", ".kicker", ".title", ".standfirst", "#bar", ".fbar-top", ".fday-rail", "#f-day", ".filters", "#list .day:first-child .day-head"];
    const out = {};
    for (const s of sel) {
      const el = document.querySelector(s);
      if (!el) { out[s] = "MISSING"; continue; }
      const r = el.getBoundingClientRect();
      out[s] = { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) };
    }
    // How many lines does the kicker wrap to?
    const k = document.querySelector(".kicker");
    out.kickerLines = Math.round(k.getBoundingClientRect().height / parseFloat(getComputedStyle(k).lineHeight || "16"));
    out.kickerText = k.innerText.replace(/\s+/g, " ").trim();
    out.titleFS = getComputedStyle(document.querySelector(".title")).fontSize;
    out.titleLH = getComputedStyle(document.querySelector(".title")).lineHeight;
    // Overlap test: does any header child sit on top of the next?
    const kids = [...document.querySelectorAll(".masthead .wrap > *")];
    out.overlaps = kids.some((k2, i) => i && k2.getBoundingClientRect().top < kids[i - 1].getBoundingClientRect().bottom - 0.5);
    // Row anatomy: where does price live relative to the tags?
    const row = document.querySelector("#list .row");
    out.row = {
      title: row.querySelector(".title-e")?.textContent.trim().slice(0, 40),
      tagsHTML: row.querySelector(".tags")?.textContent.replace(/\s+/g, " ").trim(),
      meta: row.querySelector(".meta")?.textContent.replace(/\s+/g, " ").trim(),
    };
    return out;
  });
  console.log(JSON.stringify(m, null, 2));
  await b.close();
})();
