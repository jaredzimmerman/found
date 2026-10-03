"""Can SCRAP be parsed from static HTML, or does it need a browser?

The page is Google Sites. Its text arrives as hundreds of
`<span class="C9DxTc ">` fragments that split words and even times mid-token:
`>1</span><span>1</span><span>:00 </span>` is "11:00". So the question is
whether block boundaries survive tag-stripping.

Two candidate reconstructions, from the same fetched bytes:
  SPAN-JOIN   concatenate every span in document order, no separators
  BLOCK-KEEP  keep the text of block-level elements only (h1/h2/h3/p/div-run)
              so each rendered line stays on its own line

If either reproduces the sequence the browser shows — kicker, title, instructor,
date, time, status — the source is a plain fetch. If neither does, it needs a
headless browser and the cron must say so out loud rather than quietly
publishing nothing.

Fetched once, cached to disk, so the two decoders are compared on identical bytes.
"""
import html
import os
import re
import time
import urllib.request

URL = "https://www.scrap-sf.org/workshops"
CACHE = "/tmp/scrap-static.html"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# The 429 probe earlier showed the minimal header set is refused; a full
# browser header set gets a 200. This source is a Google property, same as
# Omnivore's storefront, so the same rule applies.
HDR = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

if os.path.exists(CACHE) and time.time() - os.path.getmtime(CACHE) < 900:
    raw = open(CACHE, encoding="utf-8", errors="replace").read()
    print(f"cached page: {len(raw):,} bytes")
else:
    req = urllib.request.Request(URL, headers=HDR)
    with urllib.request.urlopen(req, timeout=45) as r:
        print(f"HTTP {r.status}")
        raw = r.read().decode("utf-8", "replace")
    open(CACHE, "w").write(raw)
    print(f"fetched page: {len(raw):,} bytes")

DOW = r"(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)"
MON = (r"(?:January|February|March|April|May|June|July|August|September|October|"
       r"November|December)")
DATE_RX = re.compile(rf"{DOW},\s*{MON}\s+\d{{1,2}}", re.I)

# ------------------------------------------------------------------ decoder A
body = raw.split("<body", 1)[-1]
body = re.split(r"<script\b", body, flags=re.I)[0]
span_join = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", "", body))).strip()

# ------------------------------------------------------------------ decoder B
# Google Sites emits each visible line as a run of spans inside one block
# element. Keeping block boundaries and joining spans WITHIN a block is the
# reconstruction that should match what the browser renders.
blocks = re.findall(
    rf"<(h1|h2|h3|h4|p|li)\b[^>]*>(.*?)</\1>", body, re.S | re.I)
block_keep = []
for _tag, chunk in blocks:
    txt = html.unescape(re.sub(r"<[^>]*>", "", chunk))
    txt = re.sub(r"\s+", " ", txt).strip()
    if txt:
        block_keep.append(txt)

MONTHS_RE = re.compile(rf"{MON}\s+\d{{1,2}}", re.I)


def report(name, text, is_lines):
    print(f"\n{'=' * 72}\n{name}\n{'=' * 72}")
    if is_lines:
        hits = [(i, l) for i, l in enumerate(text) if MONTHS_RE.search(l)]
        print(f"lines: {len(text)}   lines with a month+day: {len(hits)}")
        for i, l in hits[:12]:
            lo = max(0, i - 3)
            print(f"\n  --- around line {i} ---")
            for j in range(lo, min(len(text), i + 4)):
                mark = ">>" if j == i else "  "
                print(f"  {mark} {j:3} {text[j][:88]}")
    else:
        hits = list(MONTHS_RE.finditer(text))
        print(f"chars: {len(text):,}   month+day matches: {len(hits)}")
        for m in hits[:10]:
            i = m.start()
            print(f"\n  --- {m.group(0)!r} ---")
            print("  " + repr(text[max(0, i - 150):i + 90]))


report("A. SPAN-JOIN (all text, whitespace collapsed)", span_join, False)
report("B. BLOCK-KEEP (block elements, spans joined within each)", block_keep, True)

print("\n" + "=" * 72)
okA = len(MONTHS_RE.findall(span_join))
okB = sum(1 for l in block_keep if MONTHS_RE.search(l))
print(f"A yields {okA} dated positions, B yields {okB} dated lines")
print("Verdict: whichever reconstructs kicker/title/instructor/date/time/status")
print("in order is the plain-fetch parser. If neither does, this source needs")
print("a browser and the cron must carry that cost openly.")
