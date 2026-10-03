"""Does the Omnivore PRODUCT PAGE carry a machine-readable event date?

Every other avenue is now closed and the reasons are recorded, not guessed:

  · products.json          200, keyless, 23 products — but `published_at` is a
                           CMS publish date (Mar–Sep 2026 on a collection called
                           "upcoming events"), and `created_at` is the same.
  · static collection HTML 0 month/day strings, 0 `alt` text, 0 JSON-LD,
                           0 `datetime=`, 0 metafields, and the event grid is
                           client-rendered so even the product links are absent.
  · rendered collection    Playwright showed title + "0.00 USD" and NO date.
  · poster PNG             the date IS printed — "Tuesday / 6 / October /
                           6:30 pm" — but as PIXELS. A vision model reads it
                           correctly; a scraper cannot.

That leaves the product detail page. It is fetched here through a real browser
rather than `urllib` because the host is currently returning 429 to plain HTTP
from this IP, and the browser path is a different request signature. This is the
last place a date can be, and the answer decides whether Omnivore is addable
without a vision step.

Prints a clear verdict either way; never guesses a date.
"""
import re

from playwright.sync_api import sync_playwright

HANDLE = ("ali-francis-author-talk-the-curious-lives-of-vegetables-an-artful-"
          "exploration-of-the-wonderful-world-of-edible-plants-their-history-and-"
          "their-crucial-role-in-our-future")
URL = f"https://omnivorebooks.myshopify.com/products/{HANDLE}"

MONTHS = ("January|February|March|April|May|June|July|August|September|October|"
          "November|December")
DATE_PAT = re.compile(rf"({MONTHS})\s+(\d{{1,2}})(?:st|nd|rd|th)?", re.I)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context().new_page()
    xhr = []
    page.on("request", lambda r: xhr.append(r.url)
            if r.resource_type in ("xhr", "fetch") else None)

    # NOT `networkidle`. The host is rate-limiting this IP, so third-party
    # subresources stall and `networkidle` waits out the full 90s and then
    # raises — a timeout here means nothing about the page. `domcontentloaded`
    # plus a fixed settle reads the server-rendered DOM, which is the only thing
    # this probe needs.
    page.goto(URL, wait_until="domcontentloaded", timeout=90000)
    page.wait_for_timeout(6000)

    print(f"title: {page.title()[:90]}")

    text = page.inner_text("body")
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    dated = [l for l in lines if DATE_PAT.search(l)]
    print(f"visible lines: {len(lines)}   with a month/day: {len(dated)}")
    for l in dated[:12]:
        print(f"   {l[:120]}")

    print("\ntime-shaped strings:")
    for m in re.findall(r"\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)", text)[:10]:
        print(f"   {m}")

    print("\nstructured data on the rendered page:")
    ld = page.evaluate("""() => {
      const out = [];
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try { out.push(JSON.parse(s.textContent)); } catch (e) {}
      }
      return out;
    }""")
    for blk in ld:
        nodes = blk if isinstance(blk, list) else [blk]
        for n in nodes:
            print(f"   @type={n.get('@type')} name={str(n.get('name'))[:44]!r}")
            for k in ("startDate", "endDate", "location", "offers"):
                if n.get(k):
                    print(f"      {k}: {str(n[k])[:90]}")

    for lab, pat in [("<time>", r"<time"), ("datetime=", r'datetime='),
                     ("'startDate'", r'"startDate"'), ("starts_at", r"starts_at"),
                     ("20xx-xx-xx", r"20\d{2}-\d{2}-\d{2}"),
                     ("appointment", r"appointment")]:
        n = len(re.findall(pat, page.content(), re.I))
        if n:
            print(f"   {lab:14} {n}")

    print(f"\nXHR/fetch calls: {len(xhr)}")
    for u in xhr[:14]:
        print(f"   {u[:120]}")

    page.screenshot(path="/tmp/omnivore-product.png", full_page=False)
    browser.close()

print("\nscreenshot: /tmp/omnivore-product.png")
