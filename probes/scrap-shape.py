"""Does a SCRAP date line actually carry a title and a time?

The probe proved the rendered page has date lines ("Sunday, October 11") and
that the /schedule holding page is empty. What it did NOT prove is whether a
date is bound to a workshop — or whether it is an orphaned heading with the
title on a sibling line, or with the two in different DOM subtrees entirely.

Three shapes are possible and each implies a different parser:
  BOUND      one block holds title + date + time together -> regex per block
  SIBLING    the block holds a date, the title is an adjacent heading
  CARD       date and title are in sibling cards -> walk a container

So: dump the DOM ancestry of each date node and show what sits in its parent.
This is a shape question, so the answer has to be the actual HTML, not a guess.
"""
from playwright.sync_api import sync_playwright

URL = "https://www.scrap-sf.org/workshops"

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1400, "height": 1200})
    page = ctx.new_page()
    page.goto(URL, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(4000)

    # ---- 1. the visible lines, in order, with their index
    lines = page.evaluate("""() => document.body.innerText.split('\\n')
        .map(s => s.trim()).filter(s => s)""")
    print(f"visible lines: {len(lines)}\n")
    for i, l in enumerate(lines):
        print(f"  {i:3} | {l[:96]}")

    # ---- 2. ancestry + siblings of the first three date-bearing nodes
    print("\n" + "=" * 74)
    print("DOM shape around each date node")
    print("=" * 74)
    shapes = page.evaluate("""() => {
      const RX = /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\\s+
                  (January|February|March|April|May|June|July|August|September|
                   October|November|December)\\s+\\d{1,2}/x;
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = (n.textContent || '').trim();
        if (t.length > 120 || !RX.test(t)) continue;
        // Walk up to the nearest element whose text is under 400 chars — that
        // is the block a parser would treat as one unit.
        let el = n.parentElement, block = null;
        while (el) {
          if ((el.innerText || '').length < 400) { block = el; break; }
          el = el.parentElement;
        }
        if (!block) continue;
        out.push({
          nodeText: t,
          tag: block.tagName,
          cls: (block.className || '').slice(0, 60),
          blockText: (block.innerText || '').replace(/\\n/g, ' | ').slice(0, 260),
          parentText: block.parentElement
            ? (block.parentElement.innerText || '').replace(/\\n/g, ' | ').slice(0, 300)
            : null,
          parentTag: block.parentElement ? block.parentElement.tagName : null,
        });
      }
      return out;
    }""")

    seen = set()
    for s in shapes:
        key = (s["nodeText"], s["tag"], s["blockText"])
        if key in seen:
            continue
        seen.add(key)
        print(f"\ndate node : {s['nodeText']!r}")
        print(f"block     : <{s['tag']} class={s['cls']}>")
        print(f"block text: {s['blockText']}")
        print(f"parent    : <{s['parentTag']}>")
        print(f"parent txt: {str(s['parentText'])[:280]}")

    print(f"\n\ndistinct date-bearing blocks: {len(seen)}")
    page.close()
    ctx.close()
    b.close()
