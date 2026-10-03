"""Capture and dump the SCRAP workshops calendar as it actually renders.

Kept separate from scrap-probe.py because that one ends on a 404 and writes the
screenshot at the end, so it photographed the wrong page. Here the workshops
page is photographed first and the DOM dumped alongside, so the listing shape
can be read as text instead of guessed from a picture.
"""
from playwright.sync_api import sync_playwright

URL = "https://www.scrap-sf.org/workshops"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 1400})
    pg.goto(URL, wait_until="networkidle", timeout=90000)
    pg.wait_for_timeout(5000)

    pg.screenshot(path="/tmp/scrap-workshops.png", full_page=False)

    txt = pg.inner_text("body")
    lines = [l.strip() for l in txt.split("\n") if l.strip()]
    print("VISIBLE TEXT LINES:", len(lines))
    for i, l in enumerate(lines):
        print(f"  {i:3} {l[:150]}")

    print("\n" + "=" * 70)
    print("DOM SHAPE: elements containing a 2026/2025 date string")
    print("=" * 70)
    shaped = pg.evaluate("""() => {
      const rx = /(January|February|March|April|May|June|July|August|September|October|November|December)/;
      const seen = new Map();
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length) continue;
        const t = (el.textContent||'').trim();
        if (!t || t.length > 200 || !rx.test(t)) continue;
        const key = el.tagName + '.' + (el.className||'').toString().slice(0,60);
        if (!seen.has(key)) seen.set(key, {n:0, sample:t.slice(0,90)});
        seen.get(key).n++;
      }
      return [...seen.entries()].sort((a,b)=>b[1].n-a[1].n).slice(0,25);
    }""")
    for sel, info in shaped:
        print(f"  {info['n']:4}x {sel}")
        print(f"        {info['sample']}")

    print("\n" + "=" * 70)
    print("CANDIDATE ROW CONTAINERS: elements with 2+ child links")
    print("=" * 70)
    rows = pg.evaluate("""() => {
      const out = [];
      for (const el of document.querySelectorAll('div,section,article,li')) {
        const links = el.querySelectorAll(':scope > a, :scope > div > a');
        if (links.length < 2 || links.length > 6) continue;
        const t = (el.innerText||'').trim();
        if (!t || t.length > 400) continue;
        out.push({tag: el.tagName, cls: (el.className||'').toString().slice(0,50),
                  n: links.length, text: t.replace(/\\s+/g,' ').slice(0,220),
                  hrefs: [...links].map(a=>a.getAttribute('href')).slice(0,6)});
      }
      return out.slice(0, 20);
    }""")
    for r in rows:
        print(f"  <{r['tag']} class={r['cls']}> {r['n']} links")
        print(f"      {r['text'][:210]}")
        print(f"      {r['hrefs']}")

    b.close()