"""Try every candidate Eventbrite id pattern against every real URL at once.

Three separate attempts failed by editing one regex and re-reading the output.
The problem is that each candidate has to satisfy BOTH URL shapes at the same
time, and checking one against the other is how the broken one gets past you.
This scores every candidate against every case in a grid, so the winner is the
one that matches all of them — no reasoning required.
"""
import re

CASES = [
    ("bare-encoded", "https://www.eventbrite.com%2Fe%2F1987576759592?aff=Website", "1987576759592"),
    ("tickets-encoded", "https://www.eventbrite.com%2Fe%2Fspooktastic-accessories-with-"
                        "authentic-skidmark-auerstyle-tickets-2002600684556?aff=Website", "2002600684556"),
    ("registration-encoded", "https://www.eventbrite.com%2Fe%2Ffree-teacher-workshop-puppets-"
                             "with-merritt-richmond-registration-2000187580898?aff=Website", "2000187580898"),
    ("bare-plain", "https://www.eventbrite.com/e/1987576759592", "1987576759592"),
    ("tickets-plain", "https://www.eventbrite.com/e/botanical-dyeing-witchery-"
                      "tickets-2004611844219", "2004611844219"),
    ("registration-plain", "https://www.eventbrite.com/e/puppets-with-merritt-richmond-"
                           "registration-2000187580898", "2000187580898"),
    # Must NOT match.
    ("NEG home", "https://www.eventbrite.com/", None),
    ("NEG organizer", "https://www.eventbrite.com/o/scrap-12345", None),
    ("NEG 4-digit", "https://www.eventbrite.com/e/2026-10-11", None),
]

CANDIDATES = {
    "1 naive-slash":        r"eventbrite\.com(?:%2F|/)e(?:%2F|/)((?:[^?\"'<>]*?-)?\d{6,})",
    "2 optional-scheme":    r"eventbrite\.com(?:%2F%2F|//)?e(?:%2F|/)((?:[^?\"'<>]*?-)?\d{6,})",
    "3 anchor-at-e":        r"eventbrite\.com[^e]{0,8}e(?:%2F|/)(?:[^?\"'<>]*?-)?(\d{6,})",
    "4 loose-prefix":       r"eventbrite\.com.*?e(?:%2F|/)((?:[^?\"'<>]*?-)?\d{6,})",
    "5 decodes-then-matches": None,  # handled specially below
}


def try_decode(t):
    import urllib.parse
    return re.search(r"eventbrite\.com/e/(?:[^?\"'<>]*?-)?(\d{6,})", urllib.parse.unquote(t))


print(f"{'pattern':22} " + " ".join(f"{n.split('-')[0][:9]:>9}" for n, _, _ in CASES))
best = None
for name, pat in CANDIDATES.items():
    row = []
    score = 0
    for cname, url, want in CASES:
        if pat is None:
            m = try_decode(url)
        else:
            m = re.search(pat, url)
        got = m.group(1) if m else None
        ok = got == want
        score += ok
        row.append("PASS" if ok else "fail")
    print(f"{name:22} " + " ".join(f"{r:>9}" for r in row) + f"   {score}/{len(CASES)}")
    if best is None or score > best[1]:
        best = (name, score, pat)

print(f"\nbest: {best[0]}  ({best[1]}/{len(CASES)})")
print(f"pattern: {best[2] or 'decode-then-match'}")
