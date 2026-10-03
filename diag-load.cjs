const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });

  // Record every image request and its fate.
  const reqs = [];
  p.on("response", (r) => {
    if (/\.(jpe?g|png|webp|avif|gif)/i.test(r.url())) {
      reqs.push({ url: r.url().slice(0, 110), status: r.status() });
    }
  });
  p.on("requestfailed", (r) => {
    if (/\.(jpe?g|png|webp|avif|gif)/i.test(r.url())) {
      reqs.push({ url: r.url().slice(0, 110), status: "FAILED " + (r.failure()?.errorText || "") });
    }
  });

  await p.goto("https://datebook.indigokarasu.com/", { waitUntil: "networkidle" });
  await p.waitForSelector(".figure img", { timeout: 25000 });
  await p.waitForTimeout(4000);

  const st = await p.evaluate(() => {
    const els = [...document.querySelectorAll(".figure img")];
    const byState = {};
    for (const i of els) {
      const k = !i.getAttribute("src") ? "no-src-attr"
        : i.naturalWidth > 0 ? "loaded" : "no-natural-width";
      byState[k] = (byState[k] || 0) + 1;
    }
    // Why might they not load? Check the lazy attributes and the src values.
    const sample = els.slice(0, 6).map((i) => ({
      src: (i.getAttribute("src") || "").slice(0, 70),
      cur: (i.currentSrc || "").slice(0, 70),
      loading: i.getAttribute("loading"),
      nat: i.naturalWidth,
      complete: i.complete,
    }));
    // Count distinct hosts actually present in the feed.
    const withFig = document.querySelectorAll(".figure").length;
    return { total: els.length, byState, sample, withFig };
  });
  console.log("IMG STATE", JSON.stringify(st, null, 1));

  const hosts = {};
  for (const r of reqs) {
    let h = "?";
    try { h = new URL(r.url).host; } catch {}
    hosts[h] = (hosts[h] || 0) + 1;
  }
  console.log("REQUESTS by host:", JSON.stringify(hosts, null, 1));
  const codes = {};
  for (const r of reqs) codes[r.status] = (codes[r.status] || 0) + 1;
  console.log("REQUESTS by status:", JSON.stringify(codes));
  const bad = reqs.filter((r) => r.status !== 200).slice(0, 8);
  console.log("non-200:", JSON.stringify(bad, null, 1));
  await b.close();
})();
