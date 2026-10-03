"""Pin the Omnivore product-page date element, so the parser targets the real node.

`TUESDAY, OCTOBER 6 AT 6:30 PM` is visible text on the product page and is the
answer — the source is scrapable with no vision step and no browser on a cron, as
long as we fetch per-product pages rather than the collection grid.

What this establishes, before any scraper is written:
  · which element holds it (a class we can select, not "some text somewhere")
  · whether the month/day are in one node or split across several, because a
    renderer that splits them must not be read with a single textContent
  · whether the date is machine-formatted or uppercase-styled (CSS
    `text-transform` changes innerText without changing the DOM, so a scraper
    reading innerText and a test reading the DOM can disagree)
  · whether every product carries it, or only some

Read from a real browser because the host rate-limits plain HTTP from this IP.
"""
import json
import re

from playwright.sync_api import sync_playwright

CACHE = "/tmp/omnivore-cache.json"
MONTHS = ("January|February|March|April|May|June|July|August|September|October|"
          "November|December")
DATE_PAT = re.compile(rf"({MONTHS})\s+(\d{{1,2}})(?:st|nd|rd|th)?", re.I)

products = json.load(open(CACHE))["products"]
# Sample across the set: an *OFF-SITE* one (different template), a long title,
# and a short one. Coverage claims need spread, not the first record.
picks = [products[0], products[1]]
picks.append(next((p for p in products if "OFF-SITE" in p["title"]), products[2]))
picks.append(next((p for p in products if len(p["title"]) < 60), products[3]))
seen, sample = set(), []
for p in picks:
    if p["handle"] in seen:
        continue
    seen.add(p["handle"])
    sample.append(p)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context()
    for prod in sample:
        url = f"https://omnivorebooks.myshopify.com/products/{prod['handle']}"
        page = ctx.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(4500)
        except Exception as e:  # noqa: BLE001
            print(f"\nFETCH FAILED {prod['handle'][:40]}: {type(e).__name__}")
            page.close()
            continue

        print("=" * 74)
        print(f"{prod['title'][:72]}")
        print(f"  published_at={prod['published_at'][:10]}")
        print("=" * 74)

        # 1. Which element holds the date? Ask the DOM, not the rendered text.
        nodes = page.evaluate("""(months) => {
          const rx = new RegExp('(' + months + ')\\\\s+\\\\d{1,2}', 'i');
          const out = [];
          for (const el of document.querySelectorAll('body *')) {
            if (el.children.length) continue;
            const t = (el.textContent || '').trim();
            if (!t || t.length > 120 || !rx.test(t)) continue;
            out.push({tag: el.tagName, cls: (el.className||'').toString().slice(0,70),
                      id: el.id || '', text: t.slice(0,90),
                      transform: getComputedStyle(el).textTransform});
          }
          return out;
        }""", MONTHS)
        for n in nodes:
            print(f"  <{n['tag']} class={n['cls']} id={n['id']!r}>")
            print(f"      text:      {n['text']!r}")
            print(f"      transform: {n['transform']}")

        # 2. Is it uppercase in the DOM, or only in CSS?
        raw_html = page.content()
        print(f"\n  uppercase 'AT' in raw HTML: {' AT ' in raw_html}")
        print(f"  'AT' in any DOM textContent: "
              f"{' AT ' in page.evaluate('() => document.body.innerText')}")

        # 3. The venue/address block — is it in the DOM too?
        vis = page.inner_text("body")
        addr = re.findall(r"\d{3,5}[a-z]?\s+[A-Z][A-Za-z .]+(?:St|Street|Ave|Avenue|Dr|Drive|Blvd)\.?[^\n]*",
                          vis)
        print(f"  address-shaped strings: {addr[:3]}")
        for kw in ("3885", "Cesar Chavez", "FREE", "Free to attend", "Omnivore Books"):
            if kw.lower() in vis.lower():
                print(f"  contains {kw!r}")

        print(f"  XHR: {len([1])}")
        page.close()
    browser.close()
