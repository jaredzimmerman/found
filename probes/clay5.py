"""Find the ONE-TIME (single-date) Clayroom SF classes.

Potrero Hill is all 6-week courses (Session 7.5) with date RANGES. The
single-date listings are the "Try Day" classes. This checks the /workshop page
and every service-page anchor on the SF one-time index, then reports the date
shape on a class page. Evidence only.
"""
import re

from playwright.sync_api import sync_playwright

SCHED = re.compile(
    r"(?P<dow>Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s*@\s*(?P<time>[\d:]+\s*(?:am|pm))"
    r"(?:\s*(?:from|,|-)\s*(?P<m1>[A-Z][a-z]+)?\s*(?P<d1>\d{1,2})(?:st|nd|rd|th)?)?",
    re.I)


def settle(p):
    p.wait_for_timeout(1800)
    p.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
    p.wait_for_timeout(1800)
    p.evaluate("() => window.scrollTo(0, 0)")
    p.wait_for_timeout(400)


with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])

    found = {}
    for url in ["https://www.clayroomsf.com/workshop",
                "https://www.clayroomsf.com/san-francisco-one-time-classes"]:
        p = b.new_page()
        p.goto(url, wait_until="domcontentloaded", timeout=60000)
        settle(p)
        print("=" * 72)
        print(url)
        body = p.inner_text("body")
        sp = p.eval_on_selector_all(
            "a[href*='service-page']",
            "els => els.map(e => ({h:e.getAttribute('href'), t:(e.innerText||'').trim().slice(0,70)}))")
        uniq = {}
        for a in sp:
            if a["h"] and a["t"]:
                uniq.setdefault(a["h"], a["t"])
        print(f"  service-page anchors with text: {len(uniq)}")
        for h, t in list(uniq.items())[:14]:
            print(f"    {t!r:60} {h.split('/')[-1][:52]}")
            found.setdefault(h, t)
        # Look for a book/availability CTA that reveals dates
        for pat, label in [(r"\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b", "weekday"),
                           (r"\b\d{1,2}:\d{2}\s*(?:am|pm)\b", "clock"),
                           (r"\$\d+", "price"),
                           (r"Try ?Day", "tryday")]:
            hits = re.findall(pat, body, re.I)
            print(f"    {label:10} {len(hits):4} {hits[:5]}")
        p.close()

    print("\n\n=== Try Day class page date shape ===")
    for h, t in list(found.items())[:5]:
        pg = b.new_page()
        try:
            pg.goto(h, wait_until="domcontentloaded", timeout=45000)
            settle(pg)
            body = pg.inner_text("body")
        except Exception as e:
            print(f"\n  {h.split('/')[-1]} -> {type(e).__name__}")
            pg.close()
            continue
        print(f"\n  {t!r}")
        print(f"    {h[:78]}")
        for f in SCHED.finditer(body):
            g = f.groupdict()
            tail = f" {g['m1'] or ''} {g['d1'] or ''}".rstrip()
            print(f"    sched: {g['dow']} @{g['time']}{tail}")
        # also plain 'Month D' standalone dates
        md = re.findall(r"\b[A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?\b", body)
        print(f"    bare 'Month D' tokens: {md[:8]}")
        seg = re.search(r"(Service Description|Course Description)([\s\S]{0,420})", body)
        if seg:
            print("    ---\n    " + re.sub(r"\n+", "\n    ", seg.group(2)[:380]))
        pg.close()

    b.close()