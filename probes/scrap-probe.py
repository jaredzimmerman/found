"""Probe SCRAP's workshop listing with a real browser.

The static HTML is one 2.7MB script tag (Wix), so nothing is greppable without
rendering. This answers three questions in order:

  1. Does the page show dated, bookable workshops at all?
  2. If so, is that data in the static HTML or only after JS?
  3. Is there a structured feed behind it (Wix Data / JSON) we could read
     directly, which would be better than parsing rendered text?

A source is only worth wiring in if (3) or, failing that, (1) plus a stable
selector. Anything else is a scraper that breaks silently and silently again.
"""

from playwright.sync_api import sync_playwright

URL = "https://www.scrap-sf.org/workshops"
HOLDING = "https://www.scrap-sf.org/schedule"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 1200})
    captured = []

    # A gzipped POST body is what killed the first version of this probe:
    # reading r.post_data raised UnicodeDecodeError inside Playwright's own
    # event emitter and the whole run died before reaching the page. Only the
    # URL is interesting here, so never touch the body.
    def on_request(r):
        if r.resource_type in ("xhr", "fetch"):
            captured.append((r.method, r.url))

    page.on("request", on_request)

    page.goto(URL, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(4000)

    print("=" * 70)
    print(URL)
    print("=" * 70)

    title = page.title()
    print("title:", title)

    text = page.inner_text("body")
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    print(f"visible text lines: {len(lines)}")

    # 1. Is there a dated workshop list?
    months = ["january", "february", "march", "april", "may", "june", "july",
              "august", "september", "october", "november", "december"]
    dated = [l for l in lines if any(m in l.lower() for m in months)]
    print(f"lines mentioning a month: {len(dated)}")
    for l in dated[:20]:
        print("   ", l[:130])

    # 2. Any JSON-LD Event objects? Cheapest possible win.
    ld = page.evaluate("""() => {
      const out = [];
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try { out.push(JSON.parse(s.textContent)); } catch (e) {}
      }
      return out;
    }""")
    print(f"\nJSON-LD blocks: {len(ld)}")
    for block in ld:
        nodes = block if isinstance(block, list) else [block]
        for n in nodes:
            t = n.get("@type")
            print(f"   @type={t} name={n.get('name')!r}")

    # 3. Workshop anchors — what does one row link to?
    anchors = page.evaluate("""() => Array.from(document.querySelectorAll('a'))
        .map(a => ({t: (a.innerText||'').trim().slice(0,70), h: a.href}))
        .filter(x => x.t && x.h && x.h.startsWith('http'))""")
    print(f"\nanchors: {len(anchors)}")
    uniq = {}
    for a in anchors:
        path = a["h"].split("scrap-sf.org")[-1]
        uniq.setdefault(path.split("/")[1] if "/" in path[1:] else "root", []).append(a)

    print("\ntop anchor paths (section -> count):")
    for k, v in sorted(uniq.items(), key=lambda x: -len(x[1]))[:14]:
        print(f"   {k:24} {len(v)}")

    # 4. The XHR/fetch calls — this is where a readable JSON feed shows up.
    print(f"\nXHR/fetch calls: {len(captured)}")
    json_calls = [
        c for c in captured if any(k in c[1].lower() for k in ("json", "graphql", "api", "data"))
    ]
    for m, u in json_calls[:22]:
        print(f"   {m:5} {u[:130]}")

    # 5. Does a holding/schedule page exist and is it different?
    page.goto(HOLDING, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(3000)
    t2 = page.inner_text("body")
    l2 = [l.strip() for l in t2.split("\n") if l.strip()]
    dated2 = [l for l in l2 if any(m in l.lower() for m in months)]
    print("\n" + "=" * 70)
    print(HOLDING, f"-> {len(l2)} lines, {len(dated2)} mention a month")
    print("=" * 70)
    for l in dated2[:15]:
        print("   ", l[:130])

    page.screenshot(path="/tmp/scrap-workshops.png", full_page=False)
    browser.close()

print("\nscreenshot: /tmp/scrap-workshops.png")