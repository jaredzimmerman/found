"""Can SCRAP be added as a source, and with what?

Established already:
  · The rendered /workshops calendar is a Wix page. Static HTML holds every
    workshop's title, instructor, time and description, but NOT the dates.
  · It links 94 distinct Eventbrite event IDs, one per workshop.
  · `https://www.eventbrite.com/e/<id>` returns HTTP 200 with `"startDate"` as a
    full ISO-8601 string WITH a UTC offset, straight in the static HTML. No key,
    no auth, no browser.

So the viable design is: read the calendar page for the roster, then resolve
dates from Eventbrite. That is the same shape as Workshop SF (Tribe REST), so it
reuses the existing register() path and needs no new infrastructure.

This proves the whole chain end to end against the live sites, and reports how
many of the 2026 workshops actually fall in the publishing window.
"""
import html
import json
import re
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

import requests

CALENDAR = "https://www.scrap-sf.org/workshops"

# Identical to eventbrite_ids() in ../test-scrap-ebid.py, inlined because that
# file's name has a hyphen and cannot be imported. Kept in step by that test,
# which asserts the same three URL shapes plus the encoded-markup excerpt.
EB_RX = re.compile(r"eventbrite\.com/e/(?:[^?\"'<>]*?-)?(\d{6,})")


def eventbrite_ids(h):
    for url in urllib.parse.unquote(h).split('"'):
        m = EB_RX.search(url)
        if m:
            yield m.group(1)


EB = "https://www.eventbrite.com/e/{}/"
HDR = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/120 Safari/537.36"}

ids = []
html_txt = requests.get(CALENDAR, headers=HDR, timeout=45).text
for eid in eventbrite_ids(html_txt):
    if eid not in ids:
        ids.append(eid)
print(f"calendar: {len(html_txt)} bytes -> {len(ids)} distinct Eventbrite ids")

# The rendered calendar is the roster: which of these are UPCOMING 2026 events?
# A title in the page means "SCRAP lists this workshop"; the date comes from EB.
print(f"\nresolving {len(ids)} Eventbrite pages (8 at a time)...")
rows = []


def resolve(eid):
    try:
        r = requests.get(EB.format(eid), headers=HDR, timeout=30)
        if r.status_code != 200:
            return (eid, None, f"http {r.status_code}")
        h = r.text
        sd = re.search(r'"startDate"\s*:\s*"([^"]+)"', h)
        ed = re.search(r'"endDate"\s*:\s*"([^"]+)"', h)
        og = re.search(r'property="og:title" content="([^"]*)"', h)
        pr = re.search(r'"(?:minimumTicketPrice|price)"\s*:\s*"?([0-9.]+)', h)
        if not sd:
            return (eid, None, "no startDate")
        return (eid, {
            "start": sd.group(1),
            "end": ed.group(1) if ed else "",
            "title": html.unescape(og.group(1)) if og else "",
            "price": pr.group(1) if pr else "",
        }, None)
    except Exception as e:  # noqa: BLE001 — probe reports, never raises
        return (eid, None, str(e)[:60])


with ThreadPoolExecutor(max_workers=8) as ex:
    for eid, data, err in ex.map(resolve, ids):
        rows.append((eid, data, err))

ok = [r for r in rows if r[1]]
bad = [r for r in rows if not r[1]]
print(f"resolved: {len(ok)}/{len(rows)}   unresolved: {len(bad)}")
if bad:
    seen = set()
    for eid, _, err in bad:
        if err not in seen:
            seen.add(err)
            print(f"   {err}  (e.g. {eid})")

now = time.strftime("%Y-%m-%d")
print(f"\n=== every resolved date, sorted (today is {now}) ===")
seen_titles = set()
for eid, d, _ in sorted(ok, key=lambda r: r[1]["start"]):
    if d["title"] in seen_titles:
        continue
    seen_titles.add(d["title"])
    day = d["start"][:10]
    mark = "UPCOMING" if day >= now else "past"
    print(f"  {day} {d['start'][11:16]}  {mark:9} {'$' + d['price'] if d['price'] else '':6} "
          f"{d['title'][:64]}")

up = {d["title"] for _, d, _ in ok if d["start"][:10] >= now}
print(f"\ndistinct upcoming titles: {len(up)}")
print(f"in a 3-day window from today: "
      f"{sum(1 for _, d, _ in ok if now <= d['start'][:10] <= '2026-10-05')}")
