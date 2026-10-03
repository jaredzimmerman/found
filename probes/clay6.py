"""Collect the raw schedule lines from every Clayroom workshop class page.

Purpose: pin the line formats before writing a parser, and confirm which lines
belong to SF (the /workshop index also lists Oakland and San Mateo classes, which
must NOT be published). Prints evidence only.
"""
import json
import re

from playwright.sync_api import sync_playwright

DATE_HINT = re.compile(
    r"\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*|\b\d{1,2}:\d{2}\s*(?:am|pm)|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}",
    re.I)


def settle(p):
    p.wait_for_timeout(1600)
    p.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
    p.wait_for_timeout(1600)
    p.evaluate("() => window.scrollTo(0, 0)")
    p.wait_for_timeout(300)


with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
    p = b.new_page()
    p.goto("https://www.clayroomsf.com/workshop",
           wait_until="domcontentloaded", timeout=60000)
    settle(p)
    hrefs = {}
    for a in p.eval_on_selector_all(
            "a[href*='service-page']",
            "els => els.map(e => ({h:e.getAttribute('href'), t:(e.innerText||'').trim()}))"):
        if a["h"]:
            hrefs.setdefault(a["h"], a["t"][:60])
    p.close()
    print(f"{len(hrefs)} unique service-page links from /workshop\n")

    out = []
    for h, label in hrefs.items():
        # strip Wix referral query params so the published url is the clean page
        clean = h.split("?")[0]
        pg = b.new_page()
        try:
            pg.goto(clean, wait_until="domcontentloaded", timeout=45000)
            settle(pg)
            body = pg.inner_text("body")
        except Exception as e:
            print(f"{clean[:70]} -> {type(e).__name__}")
            pg.close()
            continue

        lines = [ln.strip() for ln in body.split("\n")]
        # venue line: contains a city/street
        venue_line = next((ln for ln in lines
                           if re.search(r"\b(street|st\.|ave\.|avenue|road|rd\.|broadway)\b", ln, re.I)
                           and len(ln) < 140), "")
        sched = [ln for ln in lines if DATE_HINT.search(ln) and len(ln) < 160]
        price = next((ln for ln in lines if re.fullmatch(r"\$[\d.,]+", ln.strip())), "")
        out.append({"url": clean, "label": label, "venue_line": venue_line,
                    "sched": sched[:4], "price": price})
        print(f"--- {label!r}")
        print(f"    {clean[:88]}")
        print(f"    venue: {venue_line!r}")
        print(f"    price: {price!r}")
        for s in sched[:4]:
            print(f"    sched: {s!r}")
        print()
        pg.close()

    with open("/tmp/clay_lines.json", "w") as fh:
        json.dump(out, fh, indent=1)
    print("\nwrote /tmp/clay_lines.json")

    print("\n=== SF vs not, by venue line ===")
    for o in out:
        host = re.search(r"https?://([^/]+)", o["url"]).group(1)
        sfy = bool(re.search(r"clayroomsf\.com|clayroomsoma\.com", host)) or \
            bool(re.search(r"in san francisco|potrero|soma", o["venue_line"], re.I))
        print(f"  {'SF ' if sfy else 'no '} {host:28} {o['label'][:44]}")
    b.close()