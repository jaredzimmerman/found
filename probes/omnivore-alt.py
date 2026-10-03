#!/usr/bin/env python3
"""Check the cached static collection HTML for a machine-readable event date.

The date is printed on the poster PNG as pixels ("Tuesday / 6 / October /
6:30 pm"), but a storefront routinely repeats that same text in the image's
`alt` attribute — which would make the whole source scrapable with no vision step
and no rate-limit exposure. Checking a file already on disk costs nothing and
settles the question.

This is the right move while the host is returning 429: exhaust every local
artifact before spending another request.
"""
import collections
import html
import json
import re

MONTHS = ("January|February|March|April|May|June|July|August|September|October|"
          "November|December")
DATE_PAT = re.compile(rf"({MONTHS})\s+(\d{{1,2}})(?:st|nd|rd|th)?", re.I)

raw = open("/tmp/omnivore.html", encoding="utf-8", errors="replace").read()
print(f"cached collection page: {len(raw)} bytes\n")

# ------------------------------------------------------------------ alt text
print("=== image alt attributes ===")
alts = [html.unescape(a) for a in re.findall(r'\balt="([^"]*)"', raw)]
alts = [a for a in alts if a.strip()]
print(f"  total alt attrs: {len(re.findall(chr(92) + 'balt=', raw))}   non-empty: {len(alts)}")
for a in alts[:14]:
    print(f"    {a[:110]}")

dated_alts = [a for a in alts if DATE_PAT.search(a)]
print(f"\n  alt attrs containing a month/day: {len(dated_alts)}")
for a in dated_alts[:10]:
    print(f"    {a[:130]}")

# ------------------------------------------------- any date anywhere in markup
print("\n=== date-shaped strings anywhere in the static page ===")
vis = re.sub(r"<script[^>]*>.*?</script>", " ", raw, flags=re.S | re.I)
vis = re.sub(r"<style[^>]*>.*?</style>", " ", vis, flags=re.S | re.I)
plain = html.unescape(re.sub(r"<[^>]+>", "\n", vis))
lines = [l.strip() for l in plain.split("\n") if l.strip()]
dl = [l for l in lines if DATE_PAT.search(l)]
print(f"  visible text lines: {len(lines)}   with a month/day: {len(dl)}")
for l in dl[:14]:
    print(f"    {l[:120]}")

# ------------------------------------------------------------------ metadata
print("\n=== structured metadata ===")
for lab, pat in [
    ('JSON-LD Event', r'"@type"\s*:\s*["\']Event'),
    ('JSON-LD block', r'application/ld\+json'),
    ('"startDate"', r'"startDate"'),
    ("starts_at", r"starts_at"),
    ("datetime=", r"datetime="),
    ("<time", r"<time"),
    ("metafield", r'metafield'),
    ("appointments", r'appointment'),
    ("20xx-xx-xxT", r"20\d{2}-\d{2}-\d{2}T"),
]:
    n = len(re.findall(pat, raw, re.I))
    print(f"  {lab:18} {n}")

# ------------------------------------------------------------- product cards
print("\n=== product card shape ===")
cards = re.findall(r'<li[^>]*class="[^"]*(?:grid__item|product-item)[^"]*"', raw)
print(f"  <li> product cards: {len(cards)}")
hrefs = re.findall(r'href="(/products/[^"]+)"', raw)
print(f"  /products/ links: {len(hrefs)}  distinct: {len(set(hrefs))}")
for h in sorted(set(hrefs))[:6]:
    print(f"    {h[:96]}")

# What does one card look like, exactly?
m = re.search(r"/products/[^\"]+", raw)
if m:
    seg = raw[max(0, m.start() - 2000):m.start() + 2000]
    print("\n=== markup around the first product link ===")
    txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "|", seg)))
    print("  " + re.sub(r"\|{2,}", " | ", txt)[:900])
