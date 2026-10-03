"""Bisect the Eventbrite id regex segment by segment.

Guessing at alternations has failed repeatedly; this walks the pattern from the
front so the first segment that stops matching is named explicitly.
"""
import re

T = "eventbrite.com%2Fe%2F1987576759592?aff=Website"

SEGMENTS = [
    (r"eventbrite\.com", "literal host"),
    (r"eventbrite\.com%2F", "host + encoded slash"),
    (r"eventbrite\.com%2Fe%2F", "host + encoded /e/"),
    (r"eventbrite\.com%2Fe%2F(\d{6,})", "encoded, bare id"),
    (r"eventbrite\.com(?:%2F|/)e(?:%2F|/)(\d{6,})", "naive slash alternation"),
    (r"eventbrite\.com%2Fe%2F((?:[^?\"'<>]*?-)?\d{6,})", "encoded + optional slug"),
]

for pat, label in SEGMENTS:
    try:
        m = re.search(pat, T)
    except re.error as e:
        print(f"  ERROR {label:34} {e}")
        continue
    print(f"  {'MATCH' if m else 'no   '} {label:34} "
          f"{'-> ' + m.group(1) if m and m.groups() else ''}")

print("\nwhat does the string actually contain?")
i = T.find("eventbrite")
print("  ", repr(T[i:i + 40]))
print("  the host is followed by:", repr(T[13:22]))
