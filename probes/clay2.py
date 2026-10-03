"""What does the Clayroom SF one-time-classes page actually render?

The scraper reports "0 in-window events (0 classes listed)". Three possible
causes, and only one is a bug:
  - the page is unreachable            -> an error
  - the page renders no listings       -> a parse of a genuinely empty result
  - the scraper missed listings that ARE there -> a real defect

Answer that before touching any code.
"""
import re

from playwright.sync_api import sync_playwright

URL = "https://www.clayroomsf.com/san-francisco-one-time-classes"

with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
    p = b.new_page()
    # NOT networkidle: a Wix page holds analytics sockets open indefinitely, so
    # waiting for network idle always times out and reads as a hard block.
    p.goto(URL, wait_until="domcontentloaded", timeout=60000)
    p.wait_for_timeout(3000)

    # Wix renders sections lazily. Scroll the whole page to force them, then
    # return to the top and read.
    p.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
    p.wait_for_timeout(2500)
    p.evaluate("() => window.scrollTo(0, 0)")
    p.wait_for_timeout(800)

    body = p.inner_text("body")
    print("rendered text length:", len(body))

    links = p.eval_on_selector_all("a", "els => els.map(e => e.getAttribute('href') || '')")
    cls = [a for a in links if "class" in a.lower()]
    print(f"anchors: {len(links)}; containing 'class': {len(cls)}")
    for a in cls[:12]:
        print("   ", a)

    # The scraper's exact date pattern, against the rendered text.
    dm = re.search(
        r"\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?,?\s+"
        r"(January|February|March|April|May|June|July|August|September|"
        r"October|November|December)\s+(\d{1,2})", body, re.I)
    print("\nscraper-shaped date token:", repr(dm.group(0)) if dm else None)

    for pat, label in [
        (r"\w+ \d{1,2}, \d{4}", "Month D, YYYY"),
        (r"\d{1,2}/\d{1,2}/\d{2,4}", "N/N/YY"),
        (r"\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b", "weekday word"),
        (r"\$\d+", "price"),
    ]:
        hits = re.findall(pat, body)
        print(f"  {label:14} {len(hits):4} hits  {hits[:5]}")

    print("\n=== body text, listings region ===")
    print(body[400:2600])

    # The scraper fetches /san-francisco-one-time-classes, which now renders as
    # an intro landing page (hero + prices + footer, no dates). Its own nav links
    # to /potrero-hill-classes, so check whether THAT carries the schedule.
    p2 = b.new_page()
    p2.goto("https://www.clayroomsf.com/potrero-hill-classes",
            wait_until="domcontentloaded", timeout=60000)
    p2.wait_for_timeout(3000)
    p2.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
    p2.wait_for_timeout(2500)
    p2.evaluate("() => window.scrollTo(0, 0)")
    p2.wait_for_timeout(800)
    body_p = p2.inner_text("body")
    print("\n=== /potrero-hill-classes ===")
    print("text length:", len(body_p))
    links_p = p2.eval_on_selector_all(
        "a", "els => els.map(e => e.getAttribute('href') || '')")
    cand = [a for a in links_p if a and ("class" in a.lower() or "wheel" in a.lower())]
    print(f"candidate class links: {len(cand)}")
    for a in cand[:15]:
        print("   ", a)
    for pat, label in [(r"\w+ \d{1,2}, \d{4}", "Month D, YYYY"),
                       (r"\b\d{1,2}/\d{1,2}\b", "N/N"),
                       (r"\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b", "weekday"),
                       (r"\$\d+", "price")]:
        print(f"  {label:14} {len(re.findall(pat, body_p)):4} hits {re.findall(pat, body_p)[:5]}")
    print("\n--- listings text ---")
    print(body_p[:2600])
    p2.screenshot(path="/tmp/clayroom_ph.png", full_page=False)

    p.screenshot(path="/tmp/clayroom2.png", full_page=False)
    print("\nscreenshots -> /tmp/clayroom2.png, /tmp/clayroom_ph.png")
    b.close()