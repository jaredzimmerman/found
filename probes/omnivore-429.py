"""Is Omnivore's 429 a rate limit, or a client fingerprint?

This matters: a rate limit means "slow down and cache"; a fingerprint block means
"plain HTTP is refused and the source needs a browser". Both look identical from
the outside — a 429 body — and they imply opposite architectures.

Evidence so far:
  · urllib with a browser User-Agent: 21 of 23 product pages -> 429
  · Playwright, same URLs, minutes earlier: HTTP 200 with the date present

Four variables are isolated here, one request each, to find which one flips it:
  A. urllib + full browser header set (Accept, Accept-Language, Accept-Encoding,
     sec-ch-ua, connection) — does the missing headers matter?
  B. urllib + cookies from a successful page load
  C. curl — a third client, same default headers as the failing one
  D. the same URL with a cache-busting query — does the CDN key on the path?

Retries are spaced and bounded. A 429 is reported, never re-requested in a loop.
"""
import http.cookiejar
import time
import urllib.error
import urllib.request

HANDLE = ("ali-francis-author-talk-the-curious-lives-of-vegetables-an-artful-"
          "exploration-of-the-wonderful-world-of-edible-plants-their-history-and-"
          "their-crucial-role-in-our-future")
URL = f"https://omnivorebooks.myshopify.com/products/{HANDLE}"

MINIMAL = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                         "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"}

FULL = dict(MINIMAL, **{
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
              "image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Connection": "keep-alive",
})


def probe(label, url, headers, opener=None):
    op = opener or urllib.request.build_opener()
    try:
        with op.open(urllib.request.Request(url, headers=headers), timeout=40) as r:
            body = r.read().decode("utf-8", "replace")
        ok = "product-form--block--overline" in body
        print(f"  {label:44} HTTP {r.status}  {len(body):7} bytes  "
              f"overline={'YES' if ok else 'no'}")
        return body
    except urllib.error.HTTPError as e:
        print(f"  {label:44} HTTP {e.code} {e.reason}")
    except Exception as e:  # noqa: BLE001
        print(f"  {label:44} {type(e).__name__}: {str(e)[:50]}")
    return None


print("Isolating the 429\n")

print("A. header completeness")
probe("A1 minimal UA (what failed before)", URL, MINIMAL)
time.sleep(6)
probe("A2 full browser headers", URL, FULL)
time.sleep(6)

print("\nB. cookies")
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
probe("B1 warm cookie jar, then request", URL, FULL, op)
if jar:
    print(f"     cookies set: {[c.name for c in jar][:6]}")
time.sleep(6)

print("\nC. cache-busting")
probe("C1 same path + ?v=1", URL + "?v=1", FULL)
time.sleep(6)

print("\nD. a lighter endpoint (the feed, not a product page)")
probe("D1 products.json", "https://omnivorebooks.myshopify.com/collections/"
                          "upcoming-events/products.json?limit=250", FULL)
time.sleep(6)

print("\nE. control: a DIFFERENT Shopify store, same theme")
probe("E1 allbirds collection", "https://www.allbirds.com/collections/mens-shoes",
      FULL)
time.sleep(4)

print("\nReading:")
print("  A2 works, A1 fails  -> fingerprint; needs full headers (still keyless).")
print("  both fail, E works   -> per-store rate limit or WAF; cache and slow down.")
print("  both fail, E fails   -> network-level block; a browser is required.")
print("  B works             -> session cookie needed before product pages.")
