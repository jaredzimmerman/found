"""Can SCRAP be scraped WITHOUT a browser?

The rendered page has clean, complete workshops: title, instructor, date, time,
availability, address. But the dates do not appear in the static HTML at all —
"ONE SPOT LEFT" and the instructor names are there, "Sunday, October 11" is not.

This checks whether the date survives in some other form in the raw markup:
a data attribute, a machine-readable timestamp, an ISO string, a <time> element,
or the React/wix data blob. If it does, a static fetch is viable. If it does not,
the source needs either a headless browser or a structured feed, and that is a
design decision rather than a parser tweak.
"""
import html
import json
import re

import requests

URL = "https://www.scrap-sf.org/workshops"
h = requests.get(URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=45).text

print(f"static bytes: {len(h)}")

print("\n=== date-shaped strings in the raw markup ===")
probes = {
    "human date 'Sunday, October 11'": r"Sunday, October 11",
    "any 'October 11'": r"October\s*11",
    "any 'Oct' + day": r"Oct[a-z]*\s+1[0-9]",
    "ISO 2026-10-11": r"2026-10-1[0-9]",
    "ISO w/ time": r"2026-10-1[0-9]T",
    "unix epoch (13-digit)": r"\b1[78]\d{11}\b",
    "<time> element": r"<time",
    "datetime= attribute": r'datetime=',
    "data-date attribute": r"data-date",
    "wix data-hook": r'data-hook="[^"]*date[^"]*"',
    "'date' json key": r'"date"',
    "'startDate'": r'"startDate"',
    "'eventDate'": r'"eventDate"',
    "'startTime'": r'"startTime"',
}
for label, pat in probes.items():
    n = len(re.findall(pat, h, re.I))
    print(f"  {label:30} {n:4}")

print("\n=== the component spans that make up a date ===")
for m in list(re.finditer(r"SPAN\.C9DxTc", h))[:3]:
    print("  ", repr(h[m.start() - 90 : m.start() + 190])[:300])

print("\n=== what surrounds the instructor name (structure probe) ===")
m = re.search(r"Spellbound", h)
if m:
    seg = h[max(0, m.start() - 1400) : m.start() + 2400]
    txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", seg)))
    print("  ", txt[:520])

print("\n=== data attributes present anywhere on the page ===")
attrs = sorted(set(re.findall(r"\b(data-[a-z0-9-]+)=", h, re.I)))
print("  ", attrs[:40])

print("\n=== what IS the calendar backed by? ===")
# The 2026 workshop names ARE in the static HTML (Spellbound, Boroboro), so the
# text is server-rendered. Only the DATES are absent, which points at a date
# widget rather than a fully client-side list. Find what renders them.
m = re.search(r"Boroboro", h)
if m:
    seg = h[max(0, m.start() - 3000): m.start() + 3000]
    seen = []
    for tag, cls in re.findall(r'<(\w+)[^>]*class="([^"]{0,60})"', seg):
        if tag in ("div", "section", "span", "p", "h1", "h2", "h3", "a") and (tag, cls) not in seen:
            seen.append((tag, cls))
    for tag, cls in seen[:25]:
        print(f"   <{tag} class={cls}>")

print("\n=== iframes / third-party calendar embeds ===")
for m in re.finditer(r"<iframe[^>]*>", h):
    print("   ", m.group(0)[:200])
for kw in ("BDE", "bandeau", "Repeater", "repeater", "Booking", "booking",
           "Eventbrite", "eventbrite", "Tribe", "tribe", "calendar", "addthis"):
    n = len(re.findall(re.escape(kw), h))
    if n:
        print(f"   {kw:12} {n}")

print("\n=== React/wix state blobs ===")
for key in ("__NEXT_DATA__", "wixBiSession", "warmupData", "PARAGRAPH", "viewerModel",
            "siteRevision", "compData"):
    print(f"   {key:16} {len(re.findall(re.escape(key), h)):4}")
