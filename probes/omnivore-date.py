#!/usr/bin/env python3
"""Where does the Omnivore event date actually live?

`published_at` is a CMS publish date: it spans March–September 2026 for a
collection called "upcoming events", and using it would put every event on the
day the shopkeeper created the listing. The rendered collection page shows no date
text at all — only title and "0.00 USD" — so the date is somewhere else, or
nowhere.

Candidates, checked in order of how machine-readable they are:
  A. the product page template (server-rendered — cheapest to read)
  B. a `products/<handle>.js` payload
  C. Shopify appointment-booking metafields (absent from products.json by design)
  D. the event poster IMAGE — the filenames (AuthorEvent_1.png,
     OffSiteAuthorEvent_4.png) are templates, so the date may be rendered pixels
     and exist nowhere as text.

This makes ONE request per candidate per product and never retries, because the
host rate-limits per IP and a 429 already cost one probe its data.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CACHE = "/tmp/omnivore-cache.json"
HDR = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/120 Safari/537.36"}


def get(url, tries=1):
    """Fetch once. Never loop on 429 — the ban is per-IP and grows with attempts."""
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HDR),
                                        timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            print(f"      HTTP {e.code} on {urllib.parse.urlparse(url).path[-40:]} "
                  f"(attempt {attempt + 1}/{tries})")
            if e.code in (429, 503):
                return None
        except Exception as e:  # noqa: BLE001
            print(f"      {type(e).__name__}: {e}")
    return None


products = json.load(open(CACHE))["products"]
MONTHS = ("January|February|March|April|May|June|July|August|September|October|"
          "November|December")
DATE_PAT = re.compile(rf"({MONTHS})\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s*(\d{{4}})?", re.I)

# Take a mid-list product, and one flagged *OFF-SITE* (different template).
picks = [p for p in products if "OFF-SITE" in p["title"]][:1] or products[:1]
picks += [p for p in products if "OFF-SITE" not in p["title"]][:1]

for p in picks:
    handle = p["handle"]
    print("=" * 74)
    print(f"{p['title'][:72]}")
    print(f"  published_at={p['published_at'][:10]}")
    print("=" * 74)

    # ---------------------------------------------------- A. product page HTML
    url = f"https://omnivorebooks.myshopify.com/products/{handle}"
    page = get(url)
    if page is None:
        print("  A. product page: FETCH FAILED (rate limited)")
    else:
        print(f"  A. product page: {len(page)} bytes")
        # Strip tags and look for a date in the visible text.
        vis = re.sub(r"<script[^>]*>.*?</script>", " ", page, flags=re.S | re.I)
        vis = re.sub(r"<style[^>]*>.*?</style>", " ", vis, flags=re.S | re.I)
        vis = re.sub(r"<[^>]+>", "\n", vis)
        dates = DATE_PAT.findall(vis)
        print(f"     visible month/day strings: {len(dates)}")
        for d in dates[:8]:
            print(f"       {d}")
        for lab, pat in [
            ("schema.org Event", r'"@type"\s*:\s*"Event"'),
            ("'startDate'", r'"startDate"'),
            ("'event_start'", r'event_start'),
            ("appointment app", r'"app_id"\s*:\s*"?\d+'),
            ("_app metafield", r'appointments|shopify--booking'),
            ("time tag", r"<time"),
            ("datetime attr", r'datetime='),
        ]:
            n = len(re.findall(pat, page, re.I))
            if n:
                print(f"     {lab:20} {n}")
        iso = sorted(set(re.findall(r"20\d{2}-\d{2}-\d{2}T[\d:+\-.]+", page)))
        if iso:
            print(f"     ISO datetimes: {iso[:6]}")

    # ------------------------------------------------- B. products/<handle>.js
    js = get(f"https://omnivorebooks.myshopify.com/products/{handle}.js")
    if js:
        print(f"  B. .js payload: {len(js)} bytes")
        iso = sorted(set(re.findall(r"20\d{2}-\d{2}-\d{2}", js)))
        print(f"     ISO dates: {iso[:8]}")
        if "metafields" in js:
            mfs = re.findall(r'"namespace"\s*:\s*"([^"]+)"', js)
            print(f"     metafield namespaces: {sorted(set(mfs))}")

    # --------------------------------------------------------------- image URL
    imgs = p.get("images") or []
    for im in imgs[:1]:
        print(f"  D. poster image: {im.get('src','')[:96]}")
        print(f"     {im.get('width')}x{im.get('height')}")
    print()

print("=" * 74)
print("Note: if A shows a date in the VISIBLE text, that is the answer and no")
print("browser or metafield is needed. If only the image carries it, the date is")
print("pixels and the source cannot be published honestly without a vision step.")
print("=" * 74)
