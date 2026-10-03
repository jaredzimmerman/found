"""Verify the live site after the destyle/deemoji/dateline work.

Three things only a browser can prove:
  1. the page renders rows with no pageerror (a throw mid-boot renders a full
     page and passes a console-only check),
  2. the render-boundary filters actually run — proven by intercepting the feed
     and serving a payload full of styling and emoji,
  3. the city switch still loads the right feed.
"""
import json
import re
import sys

from playwright.sync_api import sync_playwright

BASE = "https://datebook.indigokarasu.com/"

# Markers that must not survive to the DOM.
#
# Two exclusions from the naive pictograph ranges, both deliberate and both
# learned the hard way:
#
#  ★ (U+2605) is CONTENT — a film rating, part of an artist name. It sits in
#    2600–27BF beside a fire and a party popper, so the range catches it.
#  U+1F1E6–1F1FF are REGIONAL INDICATOR LETTERS. Two of them render as a
#    country flag, and "🇫🇮" is a place name. The scraper's own EMOJI range
#    stops at U+1FAFF and never covered flags, for the same reason it excludes
#    arrows (U+2190–21FF): a location feed renders routes and places.
#
# So the assertion is built from the scraper's actual rule minus those two, and
# the star gets its own positive assertion instead.
EMOJI_RE = re.compile(
    "["
    "\U0001F000-\U0001F0FF"   # mahjong through cards
    "\U0001F100-\U0001F1FF"   # enclosed alphanumerics + symbols (NOT flags, below)
    "\U0001F200-\U0001F2FF"   # enclosed ideographic
    "\U0001F300-\U0001F5FF"   # misc symbols & pictographs
    "\U0001F600-\U0001F64F"   # emoticons
    "\U0001F650-\U0001F67F"   # ornamental dingbats
    "\U0001F680-\U0001F6FF"   # transport & map
    "\U0001F700-\U0001F77F"  # alchemical
    "\U0001F780-\U0001F7FF"   # geometric shapes extended
    "\U0001F800-\U0001F8FF"   # supplemental arrows-C
    "\U0001F900-\U0001F9FF"   # supplemental symbols & pictographs
    "\U0001FA00-\U0001FA6F"   # chess
    "\U0001FA70-\U0001FAFF"   # symbols & pictographs extended-A
    # 2600-27BF SPLIT around 2605. A character range cannot skip a codepoint, so
    # "2600-27BF minus the star" cannot be written as one range — which is why
    # every earlier version of this check that claimed to exclude the star still
    # matched it. Written as \u escapes, not literal glyphs: an earlier attempt
    # used literal characters and picked U+32D4/U+32D6 (circled Hangul), because
    # U+2604 and U+2606 have no glyph anyone can type by hand.
    "\u2600-\u2604"              # U+2600-U+2604
    "\u2606-\u27bf"              # U+2606-U+27BF
    "⬀-⯿"                      # 2B00-2BFF
    "Ⓜ️ⓝℹ‼⁉™ℹ〰〽㊗"
    "️⃣‍"                       # VS16, keycap, ZWJ
    "]"
)
STYLE_RE = re.compile(r"\*\*|(?<!\w)__(?!\w)|\*(?=[A-Za-z])|`")
# Prose that must survive untouched.
MUST_KEEP = "We meet on Saturday, October 3rd for the show."

POISON = {
    "generated": "test",
    "events": [
        {
            "id": "poison-1",
            "title": "**Bold Band** at The Chapel",
            "description": (
                "**Steel Beans:** \U0001F389 party with the Castro's *only* "
                "monthly show. " + MUST_KEEP
            ),
            "venue": "The Chapel",
            "neighborhood": "Mission",
            "address": "500 Valencia St, San Francisco, CA",
            "date": "2026-10-02",
            "time": "8:00 PM",
            "url": "https://example.com/poison-1",
            "categories": ["Music"],
            "priceLabel": "Free",
        },
        {
            "id": "poison-2",
            # A title carrying ★: the filter must NOT eat it.
            "title": "Deathgasm 2 (R) ★",
            "description": "A film with a star rating and no emoji.",
            "venue": "Roxie",
            "neighborhood": "Mission",
            "address": "1127 Valencia St, San Francisco, CA",
            "date": "2026-10-02",
            "time": "7:00 PM",
            "url": "https://example.com/poison-2",
            "categories": ["Film"],
            "priceLabel": "$12",
        },
    ],
}

fails = []
passes = []


def check(name, ok, detail=""):
    (passes if ok else fails).append(name)
    print(("  ok    " if ok else "  FAIL  ") + name + (f"\n          {detail}" if detail and not ok else ""))


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    # ---- 1. live SF, unpoisoned ----
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_selector(".row", timeout=15000)
    rows = page.locator(".row").count()
    check(f"live page renders rows ({rows})", rows > 50, f"only {rows} rows")
    text = page.inner_text("body")
    check("live page has no styling markers", not STYLE_RE.search(text),
          repr(STYLE_RE.search(text).group(0)) if STYLE_RE.search(text) else "")
    check("live page has no emoji", not EMOJI_RE.search(page.inner_text("#list")))

    # ---- 2. poisoned feed proves the render gate runs ----
    page.route("**/events.json", lambda route: route.fulfill(
        status=200, content_type="application/json",
        body=json.dumps(POISON)))
    page2 = browser.new_page()
    page2.route("**/events.json", lambda route: route.fulfill(
        status=200, content_type="application/json",
        body=json.dumps(POISON)))
    errors2 = []
    page2.on("pageerror", lambda e: errors2.append(str(e)))
    page2.goto(BASE, wait_until="networkidle")
    page2.wait_for_selector(".row", timeout=15000)
    ptext = page2.inner_text("body")

    check("poisoned feed renders its rows", "Bold Band" in ptext, ptext[:200])
    check("render gate strips **bold**", "**" not in ptext)
    check("render gate strips *emphasis*", not re.search(r"\*[A-Za-z]", ptext))
    check("render gate strips backticks", "`" not in ptext)
    # Scan the LISTING AREA, not the whole body. `inner_text("body")` also
    # returns the page's inline <script> comments, and this file documents the
    # emoji rules with a literal family emoji — so a whole-body scan reports the
    # filter as broken while the rendered rows are clean. An earlier version of
    # this check did exactly that and failed against correct code.
    list_text = page2.inner_text("#list")
    check("render gate strips emoji", not EMOJI_RE.search(list_text),
          repr(EMOJI_RE.search(list_text).group(0)) if EMOJI_RE.search(list_text) else "")
    check("listing area keeps the star", "★" in list_text)
    check("render gate KEEPS the star", "★" in ptext, "star was eaten")
    check("render gate KEEPS real prose", MUST_KEEP in ptext, "prose was destroyed")
    check("no pageerror on poisoned feed", not errors2, str(errors2[:2]))

    # ---- 3. city switch still works ----
    # The trigger is #place-btn inside .kicker .place — clicking `.kicker` itself
    # hits the masthead wordmark, which intercepts the pointer, so an earlier
    # version of this test used the wrong node and timed out rather than failing.
    page3 = browser.new_page()
    errors3 = []
    page3.on("pageerror", lambda e: errors3.append(str(e)))
    page3.goto(BASE, wait_until="networkidle")
    page3.wait_for_selector(".row", timeout=15000)
    before = page3.inner_text("body")
    check("SF masthead present", "Fog & Found" in before)

    btn = page3.locator("#place-btn")
    check("city trigger exists", btn.count() == 1)
    if btn.count():
        btn.click()
        page3.wait_for_timeout(300)
        check("menu opens on click",
              page3.locator("#place-menu").get_attribute("hidden") is None)
        dc_opt = page3.locator('.place-opt[data-city="dc"]')
        check("DC option exists", dc_opt.count() == 1)
        if dc_opt.count():
            dc_opt.click()
            page3.wait_for_timeout(3000)
            after = page3.inner_text("body")
            check("DC masthead after switch", "Federal & Found" in after, after[:200])
            check("no SF city prose after switch", "San Francisco" not in after)
            check("DC switch raises no pageerror", not errors3, str(errors3[:2]))
            check("city choice persists to localStorage",
                  page3.evaluate("() => localStorage.getItem('city')") == "dc")

    browser.close()

print(f"\n{'PASS' if not fails else 'FAIL'} — {len(passes)} passed, {len(fails)} failed")
if fails:
    print("failed:", fails)
sys.exit(1 if fails else 0)