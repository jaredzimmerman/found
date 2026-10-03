"""Guard: a city table must not name another city's neighborhoods.

dc-hoods.mjs shipped with two San Francisco rows copy-pasted into it
(`california` and `broadway` -> "North Beach"). Nothing caught it because both
tables are plain arrays of regexes and nothing compared them. This asserts the
DC table contains no SF-only hood, and the SF table no DC-only hood.
"""
import re, sys

BASE = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/"

ROW = re.compile(r'\[\s*/.*?/[a-z]*\s*,\s*"([^"]+)"\s*\]')


def values(path):
    src = open(BASE + path, encoding="utf8").read()
    return [m.group(1) for m in (ROW.search(l) for l in src.splitlines()) if m]


sf = set(values("hoods.mjs"))
dc = set(values("dc-hoods.mjs"))

# The two cities' own names are legitimate in their own tables only.
CITY = {"San Francisco", "Washington"}

sf_leak = {v for v in dc if v in sf and v not in CITY}
dc_leak = {v for v in sf if v in dc and v not in CITY}

fail = False
if sf_leak:
    print(f"FAIL  dc-hoods.mjs names SF neighborhoods: {sorted(sf_leak)}")
    fail = True
else:
    print(f"  ok  dc-hoods.mjs: {len(dc)} neighborhoods, none from SF")

if dc_leak:
    print(f"FAIL  hoods.mjs names DC neighborhoods: {sorted(dc_leak)}")
    fail = True
else:
    print(f"  ok  hoods.mjs: {len(sf)} neighborhoods, none from DC")

sys.exit(1 if fail else 0)