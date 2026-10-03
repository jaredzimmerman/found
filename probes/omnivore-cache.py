#!/usr/bin/env python3
"""One single request to the Omnivore feed, cached to disk for every later read.

The first attempt at this verification was killed by a 429 immediately, because
earlier probing in the same session had already spent this store's rate budget.
That is a real operational property of the endpoint, not a transient: it is
per-IP and the scraper runs on a cron, so a naive per-event walk will get itself
throttled. Fetching once and reading from disk is both the fix for the probe and
the shape the scraper needs.

`CACHE` is honoured if it is newer than `MAX_AGE`; otherwise exactly one request
is made. Nothing here retries — a 429 is reported and the cached copy is used if
one exists, never re-requested in a loop.
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

URL = "https://omnivorebooks.myshopify.com/collections/upcoming-events/products.json?limit=250"
CACHE = "/tmp/omnivore-cache.json"
MAX_AGE = 6 * 3600
HDR = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/120 Safari/537.36", "Accept": "application/json"}


def fresh():
    return os.path.exists(CACHE) and (time.time() - os.path.getmtime(CACHE)) < MAX_AGE


if fresh():
    src = "cache"
    body = open(CACHE, encoding="utf-8").read()
else:
    src = "network"
    try:
        with urllib.request.urlopen(urllib.request.Request(URL, headers=HDR), timeout=45) as r:
            status = getattr(r, "status", 200)
            body = r.read().decode("utf-8", "replace")
        if status != 200:
            print(f"FAIL: HTTP {status}")
            sys.exit(1)
        open(CACHE, "w", encoding="utf-8").write(body)
    except urllib.error.HTTPError as e:
        # Do NOT retry. Report the class and the wait, then use a stale cache.
        print(f"FAIL: HTTP {e.code} {e.reason} from the live feed")
        print(f"      this endpoint rate-limits per IP; retrying now only extends the ban")
        if os.path.exists(CACHE):
            print(f"      using stale cache at {CACHE}")
            body = open(CACHE, encoding="utf-8").read()
            src = "stale cache"
        else:
            print("      no cache to fall back on — do not treat this as an empty feed")
            sys.exit(1)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {type(e).__name__}: {e}")
        sys.exit(1)

data = json.loads(body)
products = data.get("products", [])
print(f"source: {src}   bytes: {len(body)}   products: {len(products)}")
if not products:
    print("FAIL: parsed cleanly but held zero products — that is a contract drift, "
          "not an empty calendar")
    sys.exit(1)

import collections
import re

print("\n=== 1. STRUCTURE: field presence across all products ===")
KEYS = ["id", "title", "handle", "body_html", "published_at", "created_at",
        "updated_at", "vendor", "product_type", "tags", "variants", "images"]
for k in KEYS:
    n = sum(1 for p in products if p.get(k))
    flag = "" if n == len(products) else "   <-- NOT UNIVERSAL"
    print(f"  {k:16} {n:4}/{len(products)}{flag}")

print(f"\n  product_type: {dict(collections.Counter(p.get('product_type') for p in products))}")
non_event = [p["title"][:56] for p in products if p.get("product_type") != "Event"]
print(f"  non-Event products: {len(non_event)}")
for t in non_event:
    print(f"    - {t}")

print("\n=== price / availability (on variants, not the product) ===")
rows = []
for p in products:
    v = (p.get("variants") or [{}])[0]
    rows.append((v.get("price"), v.get("available"), len(p.get("variants") or [])))
print(f"  price values: {dict(collections.Counter(r[0] for r in rows))}")
print(f"  available:    {dict(collections.Counter(r[1] for r in rows))}")
print(f"  variant counts: {dict(collections.Counter(r[2] for r in rows))}")

print("\n=== 2. COVERAGE: which field is the event date? ===")
today = dt.date(2026, 10, 2)
win_end = today + dt.timedelta(days=2)
print(f"  window {today} .. {win_end} (3 calendar days incl. today)\n")
for field in ("published_at", "created_at", "updated_at"):
    days = sorted({p[field][:10] for p in products if p.get(field)})
    n_in = sum(1 for p in products if p.get(field)
               and today <= dt.date.fromisoformat(p[field][:10]) <= win_end)
    print(f"  {field:14} {days[0]} .. {days[-1]}   {len(days):3} distinct days   "
          f"{n_in} in window")

print("\n  published_at is a CMS publish date. If it were the event date, every")
print("  event would land on the day the shopkeeper created the listing.")
print("  Looking for a competing date field in the record...")

# Does body_html carry a human date? That is where a hand-written date would live.
months = ("January|February|March|April|May|June|July|August|September|October|"
          "November|December")
hits = collections.Counter()
for p in products:
    t = re.sub(r"<[^>]+>", " ", p.get("body_html") or "")
    for m in re.findall(rf"({months})\s+(\d{{1,2}})", t, re.I):
        hits[m[0][:3].title()] += 1
print(f"  month/day strings inside body_html: {sum(hits.values())} {dict(hits)}")

# The Shopify events app publishes appointment booking slots under a known key.
for p in products[:1]:
    print(f"\n  sample keys on one product: {sorted(p.keys())}")
    v = (p.get("variants") or [{}])[0]
    print(f"  sample variant keys:      {sorted(v.keys())}")

print("\n=== images ===")
imgs = sum(1 for p in products if p.get("images"))
print(f"  products with an image: {imgs}/{len(products)}")
print("\n=== full title list (for later title-cleaner work) ===")
for p in sorted(products, key=lambda x: x.get("published_at") or ""):
    print(f"  {p['published_at'][:10]}  {'$' + (p['variants'][0].get('price') or '?') if (p.get('variants') or [{}])[0].get('price') not in (None, '0.00') else 'free':>6}  "
          f"{p['title'][:78]}")
