"""Omnivore: with full headers we get HTTP 200 but no overline in the HTML.

That is a different fact from "the page has no date". Playwright saw the overline
in the RENDERED DOM and it was absent from `innerHTML` matches, which means it
is injected client-side. So the shape is:

  products.json      roster + prices          (server, full headers)
  product page HTML  no date                  (server)
  product page RENDERED DOM                   the date

That is the same calendar/ticketing split as SCRAP, but inside one host and one
storefront — and it means a headless browser IS required for the date.

This settles whether the source is addable at all, and measures the cost:
  1. confirm the overline is absent from server HTML but present when rendered
  2. count how many of the 23 products actually carry one when rendered
  3. time it, because a cron has a budget
"""
import json
import re
import time
import urllib.request

from playwright.sync_api import sync_playwright

HDR = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
              "image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
}
OVERLINE_CSS = "product-form--block--overline"
MONTHS = ("January|February|March|April|May|June|July|August|September|October|"
          "November|December")
SCHED = re.compile(rf"({MONTHS})\s+(\d{{1,2}})(?:[^0-9]{{0,12}}?"
                   rf"(\d{{1,2}}:\d{{2}})\s*(am|pm))?", re.I)

products = json.load(open("/tmp/omnivore-cache.json"))["products"]

# ---- 1. server HTML vs rendered DOM, one product, both ways
p0 = products[1]
url = f"https://omnivorebooks.myshopify.com/products/{p0['handle']}"
with urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=40) as r:
    server_html = r.read().decode("utf-8", "replace")
print(f"server HTML: {len(server_html)} bytes   overline present: "
      f"{OVERLINE_CSS in server_html}")
# The date might be in the page under a different form; search for the text.
m = SCHED.search(re.sub(r"<[^>]+>", " ", server_html))
print(f"a date string anywhere in server HTML: {m.group(0) if m else 'NONE'}")

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(extra_http_headers=HDR)
    page = ctx.new_page()
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(4500)
    dom = page.content()
    txt = page.inner_text("body")
    m2 = SCHED.search(txt)
    print(f"rendered DOM: {len(dom)} bytes   overline present: {OVERLINE_CSS in dom}")
    print(f"a date string in rendered text: {m2.group(0) if m2 else 'NONE'}")
    where = page.evaluate("""(cls) => {
      const el = document.querySelector('.' + cls);
      if (!el) return {found: false};
      return {found: true, text: el.innerText, html: el.outerHTML.slice(0, 220)};
    }""", OVERLINE_CSS)
    print(f"\nelement: {json.dumps(where, indent=2)[:600]}")
    page.close()

    # ---- 2. how many of the 23 carry one, and how long does it take
    print(f"\nwalking {len(products)} product pages in a browser...")
    t0 = time.time()
    dated = undated = 0
    rows = []
    for i, p in enumerate(products):
        u = f"https://omnivorebooks.myshopify.com/products/{p['handle']}"
        pg = ctx.new_page()
        try:
            pg.goto(u, wait_until="domcontentloaded", timeout=45000)
            pg.wait_for_timeout(3500)
            got = pg.evaluate("""(cls) => {
              const el = document.querySelector('.' + cls);
              return el ? el.innerText.trim() : null;
            }""", OVERLINE_CSS)
        except Exception as e:  # noqa: BLE001
            got = None
            print(f"   {i+1:2}/{len(products)} {type(e).__name__}: {p['handle'][:30]}")
        if got and SCHED.search(got):
            mm = SCHED.search(got)
            rows.append((mm.group(1)[:3], mm.group(2),
                         f"{mm.group(3)}{mm.group(4)}" if mm.group(3) else "TBA",
                         p["title"][:52]))
            dated += 1
        else:
            undated += 1
        pg.close()
    el = time.time() - t0

print(f"\ndated {dated}, undated {undated}, in {el:.0f}s "
      f"({el / max(1, len(products)):.1f}s per page)")
print("=" * 74)
for mon, day, clock, title in sorted(rows):
    print(f"  {mon:4} {day:>2} {clock:8} {title}")
print("=" * 74)
