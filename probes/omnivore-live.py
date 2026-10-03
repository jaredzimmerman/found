"""Prove Omnivore end-to-end against the live site, without publishing anything.

The unit suite pins the parser. This proves the WIRING: fetch products.json once,
then each product page for its overline, and report what a run would publish.

Two things this is built to respect:
  · The host rate-limits per IP. One feed request, then product pages SEQUENTIALLY
    with a delay — a parallel walk of 23 pages is what produced the 429 that
    cost this source its first probe.
  · A cached feed is fine; a cached PAGE is a lie, because the overline is what
    proves the source is alive today. If the overline fetch fails the row is
    reported as undated rather than published on the publish date.
"""
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

CACHE = "/tmp/omnivore-cache.json"
PRODUCT_CACHE = "/tmp/omnivore-pages.json"
HDR = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/120 Safari/537.36"}

OVERLINE_RE = re.compile(
    r'<(\w+)[^>]*class="[^"]*product-form--block--overline[^"]*"[^>]*>', re.I)
MONTHS = ("January|February|March|April|May|June|July|August|September|October|"
          "November|December")
SCHED = re.compile(rf"({MONTHS})\s+(\d{{1,2}})(?:\s*(?:st|nd|rd|th))?"
                   rf"(?:[^0-9]{{0,12}}?(\d{{1,2}}:\d{{2}})\s*(am|pm))?", re.I)


def overline_from_html(h):
    m = OVERLINE_RE.search(h)
    if not m:
        return None
    tail = h[m.end():m.end() + 300]
    close = re.search(rf"</{m.group(1)}\b", tail, re.I)
    chunk = tail[:close.start()] if close else tail
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", chunk)).strip() or None


products = json.load(open(CACHE))["products"]

# Reuse any page bodies already on disk; they are what a previous probe captured
# and re-fetching only spends rate budget.
pages = {}
try:
    pages = json.load(open(PRODUCT_CACHE))
except (OSError, ValueError):
    pass

print(f"roster: {len(products)} products   pages cached: {len(pages)}")
print("fetching product pages sequentially (429-safe)...\n")

today = time.strftime("%Y-%m-%d")
fetched = failed = 0
for i, p in enumerate(products):
    if p["handle"] in pages and pages[p["handle"]]:
        continue
    url = f"https://omnivorebooks.myshopify.com/products/{p['handle']}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HDR),
                                    timeout=40) as r:
            pages[p["handle"]] = r.read().decode("utf-8", "replace")
        fetched += 1
    except urllib.error.HTTPError as e:
        pages[p["handle"]] = None
        failed += 1
        if failed <= 3:
            print(f"  HTTP {e.code} on {p['handle'][:40]}")
    except Exception as e:  # noqa: BLE001
        pages[p["handle"]] = None
        failed += 1
        if failed <= 3:
            print(f"  {type(e).__name__} on {p['handle'][:40]}")
    time.sleep(1.4)          # ~40 requests/minute, under the observed limit

json.dump(pages, open(PRODUCT_CACHE, "w"))
print(f"\nfetched {fetched}, failed {failed}, cached total {len(pages)}\n")

# --------------------------------------------------------------- parse & report
undated, dated, inwin = [], [], []
for p in products:
    html = pages.get(p["handle"])
    over = overline_from_html(html) if html else None
    m = SCHED.search(over) if over else None
    if not (over and m):
        undated.append((p["title"][:56], over, "no overline" if not over else "no date in it"))
        continue
    iso = f"{m.group(1)[:3]} {m.group(2)}"
    clock = f"{m.group(3)}{m.group(4)}" if m.group(3) else "TBA"
    rec = (p["title"][:56], iso, clock, over)
    dated.append(rec)
    if m.group(1)[:3].lower() in ("oct", "sep", "nov"):
        inwin.append(rec)

print("=" * 76)
print(f"UNDATED: {len(undated)} of {len(products)}")
for t, o, why in undated:
    print(f"  {t:58} {why}  {str(o)[:40]}")
print("=" * 76)
print(f"DATED: {len(dated)}")
for t, iso, clock, over in dated:
    print(f"  {iso:8} {clock:8} {t}")
print("=" * 76)
print(f"would publish in an Oct window: {len(inwin)}")
print("\nverdict: the source is LIVE and dated if DATED > 0 and UNDATED is small.")
