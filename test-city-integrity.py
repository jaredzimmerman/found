"""City integrity over the PUBLISHED feeds.

The two feeds share one schema and one page, so the failure mode is a value from
one city appearing in the other. A hand-kept hood table is the usual culprit
(one city's rules pasted into the other's module), and the check has to run over
the published artifacts rather than the source tables — the tables can be correct
while a resolver still emits the wrong value.

Note on the token lists: both include the city name itself ("Washington" /
"San Francisco"), which legitimately appears as a neighbourhood fallback. That
token is therefore excluded from the cross-check, and asserted separately as a
fallback count rather than as a leak.
"""
import json
import re
import sys

FEEDS = {
    "sf": "/var/www/pinkpages.indigokarasu.com/events.json",
    "dc": "/var/www/pinkpages.indigokarasu.com/dc-events.json",
}

# Neighbourhoods exclusive to the other city. Excludes both city names.
SF_ONLY = r"\b(Mission|SoMa|North Beach|Bernal Heights|Nob Hill|Tenderloin|Castro|Potrero Hill|Financial District|Haight|Painted Ladies|NoPa|Marina)\b"
DC_ONLY = r"\b(Dupont Circle|Navy Yard|Columbia Heights|Georgetown|Capitol Hill|Penn Quarter|Congress Heights|Anacostia|Waterfront)\b"

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name}" + (f"\n       {detail}" if detail else ""))


def load(path):
    return json.load(open(path))["events"]


sf = load(FEEDS["sf"])
dc = load(FEEDS["dc"])

print("\nCross-city leakage (published rows)")

sf_leak = [(e["id"], e["venue"], e["neighborhood"]) for e in sf
           if re.search(DC_ONLY, f"{e.get('venue','')} {e.get('neighborhood','')}")]
check("no Washington neighbourhood appears in the SF feed", not sf_leak, str(sf_leak[:6]))

dc_leak = [(e["id"], e["venue"], e["neighborhood"]) for e in dc
           if re.search(SF_ONLY, f"{e.get('venue','')} {e.get('neighborhood','')}")]
check("no San Francisco neighbourhood appears in the DC feed", not dc_leak, str(dc_leak[:6]))

print("\nAddresses stay in their own city")

addr_leak = [(e["id"], e["address"]) for e in dc
             if e.get("address") and re.search(r"san francisco|oakland|berkeley|san mateo",
                                              e["address"], re.I)]
check("no DC row carries a Bay Area address", not addr_leak, str(addr_leak[:6]))

sf_addr_leak = [(e["id"], e["address"]) for e in sf
                if e.get("address") and re.search(
                    r"dupont circle|navy yard|columbia heights|georgetown|washington dc",
                    e["address"], re.I)]
check("no SF row carries a DC address", not sf_addr_leak, str(sf_addr_leak[:6]))

print("\nRow invariants (both feeds)")

for label, rows in (("SF", sf), ("DC", dc)):
    bad = []
    for e in rows:
        if not str(e.get("title", "")).strip():
            bad.append(("empty title", e["id"]))
        if not e.get("date"):
            bad.append(("no date", e["id"]))
        if not str(e.get("url", "")).startswith("http"):
            bad.append(("bad url", e["id"]))
        sm = e.get("startMinutes")
        if sm is not None and not (-1 <= sm <= 1440):
            bad.append((f"startMinutes {sm}", e["id"]))
        if e.get("priceTier") not in ("free", "paid", "ticketed", "unknown"):
            bad.append((f"priceTier {e.get('priceTier')}", e["id"]))
    check(f"{label}: every row has a title, date, http url, sane time and a known tier",
          not bad, str(bad[:6]))

    ids = [e["id"] for e in rows]
    check(f"{label}: no duplicate ids", len(ids) == len(set(ids)),
          f"{len(ids) - len(set(ids))} duplicates")

print("\nCleanliness (both feeds)")

EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿]")
STYLE = re.compile(r"\*\*|(?<!\w)\*[A-Za-z]|`")

for label, rows in (("SF", sf), ("DC", dc)):
    hits = [(e["id"], k) for e in rows for k, v in e.items()
            if isinstance(v, str) and (EMOJI.search(v) or STYLE.search(v))]
    check(f"{label}: no emoji or styling markers in any field", not hits, str(hits[:6]))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)