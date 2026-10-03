#!/usr/bin/env python3
"""Verify Omnivore Books' Shopify JSON before writing a single line of parser.

Three questions, in order, each answering a different way the source can lie:

  1. STRUCTURE — do all N products carry the same fields, or does the schema vary
     per product? A field present on 12 of 16 is a field needing a fallback.
  2. COVERAGE — how many land in the publishing window vs. past. A feed that is
     90% past events is healthy but out of window, and that is a different answer
     from "nothing to scrape".
  3. SANITY — do the derived fields survive? published_at is a CMS publish date,
     NOT an event date, which is the classic trap: every event would land on the
     day the shopkeeper created the listing. The real event date has to be proven
     to live somewhere else in the record.

The `products.json` endpoint is the documented, keyless Shopify collection feed and
returns server-rendered JSON — no browser required. That is the whole reason this
source is worth adding.
"""
import collections
import datetime as dt
import html
import json
import re
import sys
import urllib.request

URL = "https://omnivorebooks.myshopify.com/collections/upcoming-events/products.json?limit=250"
HDR = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/120 Safari/537.36"}

req = urllib.request.Request(URL, headers=HDR)
with urllib.request.urlopen(req, timeout=45) as r:
    data = json.loads(r.read().decode("utf-8"))

products = data.get("products", [])
print(f"endpoint: {URL}")
print(f"products: {len(products)}\n")

if not products:
    print("FAIL: zero products — the feed returned a shell, not data")
    sys.exit(1)

# ---------------------------------------------------------------- 1. structure
print("=" * 72)
print("1. STRUCTURE — field presence across all products")
print("=" * 72)
KEYS = ["id", "title", "handle", "body_html", "published_at", "created_at",
        "updated_at", "vendor", "product_type", "tags", "variants", "images"]
for k in KEYS:
    n = sum(1 for p in products if p.get(k))
    flag = "" if n == len(products) else "   <-- NOT UNIVERSAL"
    print(f"  {k:16} {n:4}/{len(products)}{flag}")

pt = collections.Counter(p.get("product_type") for p in products)
print(f"\n  product_type values: {dict(pt)}")
bad_pt = [p["title"][:50] for p in products if p.get("product_type") != "Event"]
if bad_pt:
    print(f"  non-Event products: {bad_pt}")
    print("  -> a filter on product_type=='Event' would drop these")

# Price lives on variants, not on the product.
prices = []
for p in products:
    v = (p.get("variants") or [{}])[0]
    prices.append((p["title"][:44], v.get("price"), v.get("available"),
                   len(p.get("variants") or [])))
print(f"\n  variants per product: {collections.Counter(n for _, _, _, n in prices)}")
print(f"  distinct prices: {collections.Counter(pr for _, pr, _, _ in prices)}")
print(f"  availability flags: {collections.Counter(a for _, _, a, _ in prices)}")

# ------------------------------------------------------ 2. coverage / windowing
print("\n" + "=" * 72)
print("2. COVERAGE — published_at vs the publishing window")
print("=" * 72)
today = dt.date(2026, 10, 2)
win_end = today + dt.timedelta(days=2)   # 3 calendar days incl. today
print(f"today {today}, window {today}..{win_end} inclusive\n")


def parse_iso(s):
    return dt.datetime.fromisoformat(s) if s else None


pub = [parse_iso(p.get("published_at")) for p in products]
inwin = [p for p, d in zip(products, pub) if d and today <= d.date() <= win_end]
future = [p for p, d in zip(products, pub) if d and d.date() > win_end]
past = [p for p, d in zip(products, pub) if d and d.date() < today]
print(f"  published_at in window: {len(inwin)}")
print(f"  published_at future:    {len(future)}")
print(f"  published_at past:      {len(past)}")

for p in inwin:
    print(f"    {p['published_at'][:10]}  {p['title'][:66]}")

# --------------------------------------------------------------- 3. real date
print("\n" + "=" * 72)
print("3. THE REAL EVENT DATE — published_at is NOT it")
print("=" * 72)
# If published_at were the event date, every listing would fall on the day a
# shopkeeper created it. Check the spread and look for a competing field.
spans = sorted({d.date() for d in pub if d})
print(f"  published_at spans {spans[0]} .. {spans[-1]}  ({len(spans)} distinct days)")
print(f"  updated_at  spans "
      f"{min(p['updated_at'][:10] for p in products)} .. "
      f"{max(p['updated_at'][:10] for p in products)}")
print("  ^ a publish-date field spread over months cannot be the event schedule")

# Where does the event date actually live? The rendered listing showed no date at
# all in inner_text, so it is either in the metafields, in the product template,
# or on the Shopify event appointment booking. Probe the metafield namespace.
print("\n  probing for a machine-readable event date...")
for path in ("https://omnivorebooks.myshopify.com/collections/upcoming-events/products/"
             + products[0]["handle"] + ".js"):
    try:
        req2 = urllib.request.Request(path, headers=HDR)
        with urllib.request.urlopen(req2, timeout=30) as r2:
            body = r2.read().decode("utf-8", "replace")
        print(f"    {path.rsplit('/', 1)[-1][:40]}: HTTP 200, {len(body)} bytes")
        for lab, pat in [
            ("'date' key", r'"date"\s*:'),
            ("'starts_at'", r'"starts_at"\s*:'),
            ("'event_date'", r'"event_date"\s*:'),
            ("'startDate'", r'"startDate"\s*:'),
            ("'options_with_values'", r'"options_with_values"'),
            ("'variant_options'", r'"variant_options"'),
        ]:
            n = len(re.findall(pat, body))
            if n:
                print(f"      {lab:24} {n}")
        if re.search(r"\d{4}-\d{2}-\d{2}T", body):
            print("      ISO datetimes present:",
                  re.findall(r'"\d{4}-\d{2}-\d{2}T[\d:+\-.]+"', body)[:4])
    except Exception as e:
        print(f"    probe failed: {type(e).__name__}: {e}")

# Also: does the collection page carry a date-bearing script the scraper missed?
print("\n  checking the collection page for a date-bearing payload...")
req3 = urllib.request.Request(
    "https://omnivorebooks.myshopify.com/collections/upcoming-events", headers=HDR)
with urllib.request.urlopen(req3, timeout=45) as r3:
    page = r3.read().decode("utf-8", "replace")
print(f"    collection page: {len(page)} bytes")
for lab, pat in [
    ("ISO datetime", r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}"),
    ("'starts_at'", r'starts_at'),
    ("shopify section rendering", r'SectionRendering'),
    ("collection template json", r'collection_template'),
]:
    n = len(re.findall(pat, page))
    print(f"    {lab:26} {n}")
iso = sorted(set(re.findall(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", page)))
print(f"    sample ISO datetimes: {iso[:8]}")
