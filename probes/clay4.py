"""Locate Clayroom SF's ONE-TIME classes and the date each one carries.

/potrero-hill-classes mixes 6-week courses (date RANGE: "Thursday @6 pm from
October 15th-November 20th") with 1-time classes (a SINGLE date). The site nav
advertises a "1-TIME CLASSES" section, so find the anchor that isolates it and
report what date shape a single class page uses. Evidence only.
"""
import re

from playwright.sync_api import sync_playwright

SCHED = re.compile(
    r"(?P<dow>Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s*@\s*"
    r"(?P<time>[\d:]+\s*(?:am|pm))\s+from\s+"
    r"(?P<m1>[A-Z][a-z]+)\s+(?P<d1>\d{1,2})(?:st|nd|rd|th)?"
    r"(?:\s*-\s*(?:[A-Z][a-z]+\s+)?(?P<m2>[A-Z][a-z]+)?\s*(?P<d2>\d{1,2})(?:st|nd|rd|th)?)?",
    re.I)


def settle(p):
    p.wait_for_timeout(2000)
    p.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
    p.wait_for_timeout(2000)
    p.evaluate("() => window.scrollTo(0, 0)")
    p.wait_for_timeout(500)


with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
    p = b.new_page()
    p.goto("https://www.clayroomsf.com/potrero-hill-classes",
           wait_until="domcontentloaded", timeout=60000)
    settle(p)

    # Nav links that look like the 1-time-classes section.
    nav = p.eval_on_selector_all(
        "header a, nav a, a",
        """els => els.map(e => ({h: e.getAttribute('href')||'', t:(e.innerText||'').trim().slice(0,50)}))""")
    print("=== anchors mentioning 1-time / workshop / class ===")
    seen = set()
    for a in nav:
        k = (a["h"], a["t"])
        if a["h"] in seen or not a["h"]:
            continue
        seen.add(a["h"])
        if re.search(r"1-time|one-time|workshop|class", a["t"] + a["h"], re.I):
            print(f"   {a['t']!r:52} {a['h'][:80]}")

    # Every service-page anchor, with its card text, to see 6-week vs 1-time.
    sp = p.eval_on_selector_all(
        "a[href*='service-page']",
        """els => els.map(e => ({h:e.getAttribute('href'), t:(e.innerText||'').trim().slice(0,80),
                                  p:(e.closest('[data-testid],section,article,li,div')||e).innerText.slice(0,300)}))""")
    uniq = {}
    for a in sp:
        uniq.setdefault(a["h"], a)
    print(f"\n=== {len(uniq)} unique service-page listings ===")
    for h, a in list(uniq.items())[:18]:
        ctx = re.sub(r"\s+", " ", a["p"])[:150]
        print(f"\n  {a['t']!r}\n     {h[:78]}\n     card: {ctx}")

    p.close()

    # Walk a few class pages; report the schedule line shape for each.
    print("\n\n=== class pages: schedule-line shape ===")
    for slug in [a for a in list(uniq)][:6]:
        if not slug:
            continue
        url = slug if slug.startswith("http") else f"https://www.clayroomsf.com{slug}"
        pg = b.new_page()
        try:
            pg.goto(url, wait_until="domcontentloaded", timeout=45000)
            settle(pg)
            body = pg.inner_text("body")
        except Exception as e:
            print(f"\n  {url[:66]} -> ERROR {type(e).__name__}")
            pg.close()
            continue
        title = body.split("\n")
        ttl = next((x for x in title[:12] if x.strip() and "Skip to" not in x
                    and "Class Policies" not in x), "?")
        found = SCHED.findall(body)
        plain_sched = [f[0] for f in found]
        print(f"\n  {ttl[:52]!r}")
        print(f"     {url[:78]}")
        print(f"     schedule lines: {len(found)}  {plain_sched[:4]}")
        # Range vs single date
        for f in found[:3]:
            dow, time_, m1, d1, m2, d2 = f
            kind = "RANGE" if d2 else "SINGLE"
            print(f"       {kind:6} {dow} {time_} {m1} {d1}" + (f" -> {m2 or ''} {d2}" if d2 else ""))
        pg.close()

    b.close()