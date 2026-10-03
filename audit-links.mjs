// Final independent audit of the ONE criterion with known compromises: "link to
// their original venue/organizer page, not aggregators."
//
// Inheriting a green acceptance run is not verification — the count moves with
// the feed, and a PASS only says the checks in the suite exist and pass. This
// re-derives the answer from the served page + the feed, and looks for the
// specific failure modes that a boolean check would miss:
//   - tracking wrappers never unwrapped (path-embedded click ids)
//   - URLs truncated mid-path
//   - social profiles masquerading as venue pages
//   - aggregator hosts that slipped past the classifier
//   - dead links (a 404 behind a "venue site" label is worse than no link)
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
await p.waitForTimeout(900);

const links = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".row")].filter((r) => r.offsetParent !== null);
  return rows.map((r) => {
    const a = r.querySelector('a[href^="http"]');
    const tierEl = r.querySelector(".link-tier, [class*='tier']");
    return {
      title: (r.querySelector(".title, h3, .ev-title")?.textContent || "").trim().slice(0, 70),
      url: a ? a.getAttribute("href") : null,
      tier: tierEl ? tierEl.textContent.trim() : null,
      rel: a ? a.getAttribute("rel") : null,
    };
  });
});

const AGG = new Set([
  "eventbrite.com", "eventbrite.co.uk", "universe.com", "doink.com",
  "allevents.in", "patch.com", "bandsintown.com", "songkick.com",
  "seatgeek.com", "dthebay.com", "funcheap.com",
]);
const SOCIAL = new Set([
  "facebook.com", "instagram.com", "twitter.com", "x.com", "vimeo.com",
]);
// Path-embedded click tracking: these survive as a segment after a real id.
const WRAP = /(?:[/-](?:var|ri|ck|ev|trk|cid|utm|click|src)[-.][A-Za-z0-9]{4,})/i;

const hostOf = (u) => {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return "(unparseable)"; }
};

const findings = { aggregators: [], social: [], wrapped: [], truncated: [], relMissing: [] };
for (const l of links) {
  if (!l.url) continue;
  const h = hostOf(l.url);
  const bare = h.split(".").slice(-2).join(".");
  if (AGG.has(bare) || AGG.has(h)) findings.aggregators.push({ ...l, host: h });
  if (SOCIAL.has(bare) || SOCIAL.has(h)) findings.social.push({ ...l, host: h });
  const path = (() => { try { return new URL(l.url).pathname; } catch { return ""; } })();
  if (WRAP.test(path)) findings.wrapped.push({ ...l, host: h, path: path.slice(-45) });
  // A path ending in a bare token with no trailing slash is often a truncated link.
  if (path && !path.endsWith("/") && /\/[a-z0-9-]{1,3}$/i.test(path) && path.length < 24)
    findings.truncated.push({ ...l, host: h, path });
  if (!l.rel) findings.relMissing.push({ ...l, host: h });
}

// Tiers as the page actually labels them.
const byTier = {};
for (const l of links) byTier[l.tier || "(unlabelled)"] = (byTier[l.tier || "(unlabelled)"] || 0) + 1;

// Now probe a sample of the venue/box-office links for real HTTP status, so a
// "venue site" label that points at a 404 gets caught.
const sample = links.filter((l) => l.tier && /venue|box office/i.test(l.tier));
const stride = Math.max(1, Math.floor(sample.length / 14));
const probes = [];
for (let i = 0; i < sample.length; i += stride) {
  const l = sample[i];
  try {
    const r = await p.request.head(l.url, { timeout: 15000, maxRedirects: 5 });
    if (r.status() >= 400) {
      const r2 = await p.request.get(l.url, { timeout: 20000, maxRedirects: 5 });
      probes.push({ status: r2.status(), tier: l.tier, title: l.title, url: l.url });
    }
  } catch (e) {
    probes.push({ status: "ERR " + String(e.message).slice(0, 40), tier: l.tier, title: l.title, url: l.url });
  }
}
await b.close();

console.log(JSON.stringify({
  totalRendered: links.length,
  byTier,
  linkQuality: {
    aggregatorHits: findings.aggregators.length,
    socialLinks: findings.social.length,
    unUnwrappedTrackers: findings.wrapped.length,
    suspiciousTruncations: findings.truncated.length,
    missingRel: findings.relMissing.length,
  },
  samples: {
    aggregators: findings.aggregators.slice(0, 5),
    social: findings.social.slice(0, 4),
    wrapped: findings.wrapped.slice(0, 6),
    truncated: findings.truncated.slice(0, 6),
  },
  liveHttpProbes: { probed: Math.ceil(sample.length / stride), failures: probes.length, detail: probes },
}, null, 2));
