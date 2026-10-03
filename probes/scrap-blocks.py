"""Print the SCRAP workshop blocks as the parser sees them.

The unit tests caught a structural error: reading upward from the date lands on
the INSTRUCTOR line, not the title, because the instructor sits directly above
the date. Before I change the rule I want to see every block on the live page —
specifically whether the instructor line is ever absent, since that decides
whether "two lines above" is a rule or a guess.
"""
import re
import sys

sys.path.insert(0, "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2")
from test_scrap import scrapLines  # noqa: E402

DOW = "Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday"
MONTHS = ("January|February|March|April|May|June|July|August|September|October|"
          "November|December")
DATE_RX = re.compile(
    rf"^\s*(?:(?:{DOW})[a-z]*,?\s+)?({MONTHS})\s+(\d{{1,2}})(?:st|nd|rd|th)?\s*$", re.I)
SECTION_RX = re.compile(r"(?:WORKSHOPS?|EVENTS?)\s*&?\s*(?:POP-?UPS?|WORKSHOPS?)?\s*((?:19|20)\d{2})$", re.I)


def is_allcaps(s):
    """A kicker is shouted; a title and a person's name are not."""
    letters = [c for c in s if c.isalpha()]
    return bool(letters) and all(c.isupper() for c in letters)


lines = scrapLines(open("/tmp/scrap.html", encoding="utf-8", errors="replace").read())
print(f"lines: {len(lines)}\n")

dated = [i for i, l in enumerate(lines) if DATE_RX.match(l)]
print(f"dated blocks: {len(dated)}\n")

for i in dated[:26]:
    print(f"--- date line {i}: {lines[i]}")
    for j in range(max(0, i - 4), i):
        mark = "KICKER" if is_allcaps(lines[j]) else "      "
        print(f"    [{mark}] {lines[j][:88]}")
    print()

# How often is the instructor line missing? Count blocks with 1 vs 2 lines
# between the date and the nearest non-caps line.
one, two = 0, 0
for i in dated:
    above = []
    for j in range(i - 1, max(-1, i - 5), -1):
        if j < 0 or DATE_RX.match(lines[j]) or SECTION_RX.search(lines[j]):
            break
        if not is_allcaps(lines[j]):
            above.append(lines[j])
    if len(above) == 1:
        one += 1
    elif len(above) >= 2:
        two += 1
print(f"blocks with exactly 1 non-caps line above the date: {one}")
print(f"blocks with 2+ non-caps lines above the date:        {two}")
