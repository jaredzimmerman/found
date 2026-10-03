// 2 of 152 cards on a phone put the qualifier on its own line. Is that a defect
// or the line genuinely being full? Check the venue names on exactly those cards.
import { chromium, devices } from "playwright-core";

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const ctx = await b.newContext({ ...devices["Pixel 7"] });
const p = await ctx.newPage();
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), {
  waitUntil: "networkidle",
  timeout: 60000,
});
await p.evaluate(() => document.fonts.ready);
await p.mouse.move(2, 2);
await p.waitForTimeout(900);

const out = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".row")].filter((r) => r.offsetParent !== null);
  const wrapped = [];
  const ok = [];
  for (const r of rows) {
    const meta = r.querySelector(".meta");
    const prov = r.querySelector(".prov");
    const venue = r.querySelector(".venue");
    if (!meta || !prov) continue;
    const pr = prov.getBoundingClientRect();
    const vr = venue ? venue.getBoundingClientRect() : null;
    const rec = {
      venue: venue ? venue.textContent.trim() : null,
      venueW: vr ? Math.round(vr.width) : null,
      provW: Math.round(pr.width),
      metaW: Math.round(meta.getBoundingClientRect().width),
      freeAfterVenue: vr ? Math.round(meta.getBoundingClientRect().right - vr.right) : null,
      venueLen: venue ? venue.textContent.trim().length : 0,
    };
    // The 5.5px negative margin shifts the box; the real question is whether it
    // landed on a different LINE, i.e. a different flex line.
    if (vr && Math.abs(pr.top - vr.top) > 12) wrapped.push(rec);
    else ok.push(rec);
  }
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  return {
    wrappedCount: wrapped.length,
    wrapped,
    onVenueLine: ok.length,
    avgVenueWidth: avg(ok.map((r) => r.venueW || 0)),
    longestVenue: ok.map((r) => r.venueW || 0).sort((a, b) => b - a).slice(0, 5),
    // The threshold: what venue width leaves less room than the word needs.
    provWidth: ok[0] ? ok[0].provW : null,
  };
});
await b.close();
console.log(JSON.stringify(out, null, 2));
