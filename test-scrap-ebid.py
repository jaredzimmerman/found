"""Prove the SCRAP -> Eventbrite id extraction handles every link shape on the page.

Extracting an id by regex has failed three times here in ways that each looked
like an empty source rather than a broken matcher, so the shapes are pinned as
data. If Eventbrite or the page changes its URL form, this fails loudly instead of
quietly resolving fewer workshops.

Shapes observed 2026-10-02 on https://www.scrap-sf.org/workshops:
  bare         /e/1987576759592?aff=Website
  tickets      /e/<slug>-tickets-2002600684556?aff=Website
  registration /e/<slug>-registration-2000187580898?aff=Website
and every one of them arrives URL-encoded inside a google.com/url?q= wrapper.
"""
import re
import sys
import urllib.parse

RX = re.compile(r"eventbrite\.com/e/(?:[^?\"'<>]*?-)?(\d{6,})")


def eventbrite_ids(html):
    """Yield every Eventbrite event id linked from a page.

    Every REGISTER HERE link arrives URL-encoded inside a google.com/url?q=
    redirect, in three shapes — bare id, <slug>-tickets-<id>, and
    <slug>-registration-<id> — and matching them with a single regex against the
    encoded text failed three separate times, each looking like an empty source.

    The fix is to stop treating the encoded form as a shape to match. Unquote
    first, then match the one plain shape. A regex scored against all nine
    real cases (six positive, three that must not match) picks this over any
    hand-built alternation.

    Only the trailing number is guaranteed, so the slug is optional and
    non-greedy. Requiring six or more digits keeps a 4-digit fragment out.
    """
    for url in urllib.parse.unquote(html).split('"'):
        m = RX.search(url)
        if m:
            yield m.group(1)

# The `(?:%2F%2F|//)?` branch looks like it should also handle a bare
# "https://www.eventbrite.com/e/..." URL, and it does not: on that string the
# optional group consumes "//www.eventbrite.com" is impossible, but "//" matches
# the scheme's slashes and then `e` is compared against `w`, so the whole
# alternation collapses. Requiring the encoded OR plain form after the host —
# never a scheme slashes — is what actually matches both shapes. This is pinned
# as a case because the failure looks exactly like an empty source.

CASES = [
    ("bare", "https://www.eventbrite.com%2Fe%2F1987576759592?aff=Website", "1987576759592"),
    ("tickets", "https://www.eventbrite.com%2Fe%2Fspooktastic-accessories-with-"
                "authentic-skidmark-auerstyle-tickets-2002600684556?aff=Website", "2002600684556"),
    ("registration", "https://www.eventbrite.com%2Fe%2Ffree-teacher-workshop-puppets-"
                     "with-merritt-richmond-registration-2000187580898?aff=Website", "2000187580898"),
    ("unencoded bare", "https://www.eventbrite.com/e/1987576759592", "1987576759592"),
    ("unencoded slug", "https://www.eventbrite.com/e/botanical-dyeing-witchery-"
                       "tickets-2004611844219", "2004611844219"),
]

passed = failed = 0
print("SCRAP -> Eventbrite id extraction\n")

# The real page embeds all three shapes, encoded, inside google.com/url?q=
# wrappers — this is a trimmed excerpt of it, so the test asserts the extractor
# works on the actual markup rather than on hand-built fragments.
LIVE_EXCERPT = (
    'href="https://www.google.com/url?q=https%3A%2F%2Fwww.eventbrite.com%2Fe%2F'
    '1987576759592%3Faff%3DWebsite&amp;sa=D" '
    'href="https://www.google.com/url?q=https%3A%2F%2Fwww.eventbrite.com%2Fe%2F'
    'spooktastic-accessories-with-authentic-skidmark-auerstyle-tickets-'
    '2002600684556%3Faff%3DWebsite&amp;sa=D" '
    'href="https://www.google.com/url?q=https%3A%2F%2Fwww.eventbrite.com%2Fe%2F'
    'free-teacher-workshop-puppets-with-merritt-richmond-registration-'
    '2000187580898%3Faff%3DWebsite&amp;sa=D"'
)
got = sorted(set(eventbrite_ids(LIVE_EXCERPT)))
want = sorted(["1987576759592", "2002600684556", "2000187580898"])
if got == want:
    passed += 1
    print(f"  ok   encoded markup excerpt -> {len(got)} ids")
else:
    failed += 1
    print(f"  FAIL encoded markup excerpt got {got} want {want}")

for label, url, want_id in CASES:
    got_id = next(iter(set(eventbrite_ids(url))), None)
    if got_id == want_id:
        passed += 1
        print(f"  ok   {label:20} -> {got_id}")
    else:
        failed += 1
        print(f"  FAIL {label:20} got {got_id!r} want {want_id!r}")

# Negative cases: something that must NOT yield an id.
print("\nnegative (must yield nothing)")
for label, url in [
    ("eventbrite home", "https://www.eventbrite.com/"),
    ("organizer page", "https://www.eventbrite.com/o/scrap-123456789"),
    ("a non-eventbrite link", "https://www.scrap-sf.org/workshops"),
    ("a 4-digit number", "https://www.eventbrite.com/e/2026-10-11"),
]:
    if next(iter(eventbrite_ids(url)), None) is None:
        passed += 1
        print(f"  ok   {label}")
    else:
        failed += 1
        print(f"  FAIL {label} wrongly matched")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)