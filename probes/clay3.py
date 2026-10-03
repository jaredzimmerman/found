"""Find Clayroom SF's real listing structure.

The scraper reads /san-francisco-one-time-classes, which renders as a landing
page: class names and prices, no dates. The schedule lives at
/potrero-hill-classes. Before changing the parser, establish on that page:

  - what a listing element looks like (tag, classes, href shape)
  - how a date is expressed
  - whether the date is per-listing or a separate availability calendar
  - whether the class page itself carries the date (better than a calendar grid)

Prints evidence only; changes nothing.
"""
import json
import re

from playwright.sync_api import sync_playwright

CANDIDATES = [
    "https://www.clayroomsf.com/potrero-hill-classes",
    "https://www.clayroomsf.com/san-francisco-one-time-classes",
]

with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
    for url in CANDIDATES:
        p = b.new_page()
        p.goto(url, wait_until="domcontentloaded", timeout=60000)
        p.wait_for_timeout(2500)
        p.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        p.wait_for_timeout(2500)
        p.evaluate("() => window.scrollTo(0, 0)")
        p.wait_for_timeout(600)

        print("=" * 70)
        print(url)
        print("=" * 70)

        # Every anchor that could be a class listing.
        anchors = p.eval_on_selector_all(
            "a",
            """els => els.map(e => ({
                href: e.getAttribute('href') || '',
                text: (e.innerText || '').trim().slice(0, 90),
                cls: e.className || ''
            }))""")
        interesting = [a for a in anchors if a["href"] and (
            "service-page" in a["href"] or "classes" in a["href"])]
        print(f"\nanchors total={len(anchors)}  service-page/classes={len(interesting)}")
        for a in interesting[:16]:
            print(f"   {a['href'][:76]}")
            print(f"      text={a['text']!r}")

        body = p.inner_text("body")
        print(f"\nbody text length: {len(body)}")
        for pat, label in [
            (r"\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b", "weekday"),
            (r"\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b", "N/N or N/N/YY"),
            (r"\b[A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?(?:,? \d{4})?\b", "Month D"),
            (r"\b\d{1,2}:\d{2}\s*(?:am|pm)\b", "clock time"),
            (r"\$\d+", "price"),
            (r"Availability", "availability heading"),
        ]:
            hits = re.findall(pat, body)
            print(f"  {label:20} {len(hits):4}  {hits[:6]}")

        # What does the availability widget actually look like in the DOM?
        cal = p.eval_on_selector_all(
            "[class*='cal'], [class*='avail'], [class*='date'], [class*='widget'], button",
            """els => els.slice(0, 60).map(e => ({
                tag: e.tagName,
                cls: (e.className || '').toString().slice(0, 70),
                txt: (e.innerText || '').trim().slice(0, 40),
                ds: JSON.stringify(e.dataset || {}).slice(0, 80)
            }))""")
        print(f"\ncalendar-ish elements: {len(cal)}")
        for c in cal[:18]:
            if c["txt"]:
                print(f"   <{c['tag']}> {c['cls'][:52]:54} {c['txt']!r} {c['ds'][:60]}")

        p.close()

    # A single class page. The listing anchor's text is "Figure Sculpting
    # (Session 7.5)" — no date. So the date, if there is one, lives on the
    # class page itself, and that is where the scraper would have to go.
    print("\n" + "=" * 70)
    print("CLASS PAGE: intro-to-clay-session-7-5")
    print("=" * 70)
    p = b.new_page()
    p.goto("https://www.clayroomsf.com/service-page/intro-to-clay-session-7-5",
           wait_until="domcontentloaded", timeout=60000)
    p.wait_for_timeout(2500)
    p.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
    p.wait_for_timeout(2500)
    p.evaluate("() => window.scrollTo(0, 0)")
    p.wait_for_timeout(600)
    body = p.inner_text("body")
    print("body text length:", len(body))
    for pat, label in [
        (r"\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b", "weekday"),
        (r"\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b", "N/N"),
        (r"\b[A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?(?:,? \d{4})?\b", "Month D"),
        (r"\b\d{1,2}:\d{2}\s*(?:am|pm)\b", "clock"),
        (r"\$\d+", "price"),
        (r"\bSession\s*[\d.]+", "session"),
        (r"\b(?:Availability|Book|Schedule|Sign up|Enroll)\w*", "cta/availability"),
    ]:
        hits = re.findall(pat, body, re.I)
        print(f"  {label:18} {len(hits):4}  {hits[:8]}")
    print("\n--- first 2200 chars of the class page ---")
    print(body[:2200])
    p.close()
    b.close()