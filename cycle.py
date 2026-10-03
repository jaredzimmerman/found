"""One 10xEng cycle. Reads the code I just changed and looks for defects the
previous cycle would not have caught.

Prints findings only. Exit 0 = clean (this is what lets the loop stop).
"""
import json, os, re, subprocess, sys, difflib

D = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/"
WEB = "/var/www/pinkpages.indigokarasu.com/index.html"
findings = []


def note(sev, msg):
    findings.append((sev, msg))
    print(f"  [{sev}] {msg}")


# 1. The two city modules must now differ ONLY by place names. If a rule
#    drifts back into a per-city copy, this is how it drifted the first time.
#    Compare CODE with regex literals and string literals NORMALISED AWAY — the
#    city regexes are the one legitimate difference, so after masking them the
#    two files must be identical. A line-count threshold was too weak: a drifted
#    rule fit inside it and the mutation test proved the check could not fail.
def skeleton(p):
    out = []
    for l in open(p, encoding="utf8"):
        t = l.strip()
        if not t or t.startswith("//"):
            continue
        t = re.sub(r"/(?:\\.|[^/\\\n])+/[a-z]*", "<regex>", t)   # regex literal
        t = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', "<str>", t)
        out.append(re.sub(r"\s+", " ", t))
    return out

a = skeleton(D + "title-clean.mjs")
b = skeleton(D + "dc-title-clean.mjs")
d = [l for l in difflib.unified_diff(a, b, lineterm="")
     if l.startswith(("+", "-")) and not l.startswith(("+++", "---"))]
if d:
    note("HIGH", f"city cleaners differ in LOGIC ({len(d)} lines)")
    for l in d[:6]:
        print("        ", l[:100])
else:
    print(f"  ok  city cleaners identical once city regexes/strings are masked")

# 2. Every module must import what it uses. The emoji bug shipped as
#    "deemoji is not defined" twice; catch a third instance structurally.
#    Symbol names are escaped — a raw "(" in the search pattern is a regex
#    group that never closes, which is how this check crashed the first run.
#    Locally DEFINED symbols and namespace calls (CLEAN.cleanTitle) are not
#    findings: the first version of this check flagged nine of them, all
#    correctly-bound code. Only a free identifier with no binding anywhere.
for f in sorted(os.listdir(D)):
    if not f.endswith(".mjs") or f == "cycle.py":
        continue
    src = open(D + f, encoding="utf8").read()
    body = re.sub(r"^\s*import[^;]*;", "", src, flags=re.M)
    # Comments name symbols constantly ("assert on cleanTitle()") and naming a
    # function in prose is not calling it. Strip line comments before scanning.
    body = re.sub(r"//[^\n]*", "", body)
    defined = set(re.findall(
        r"(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)", src))
    for sym in ["deemoji", "neighborhoodFor", "hoodsOf", "titleCleaner",
                "neighborhoodEngine", "cleanTitle", "cleanDescription", "strip"]:
        pat = r"(?<![\w.$])" + re.escape(sym) + r"\s*\("
        if sym in defined:
            continue
        if not re.search(pat, body):
            continue
        if re.search(r"(?:import)\s*\{[^}]*\b" + re.escape(sym) + r"\b", src) \
           or re.search(r"import\s+" + re.escape(sym) + r"\b", src):
            continue
        # Bindings that are legitimate, all of them seen in this tree:
        #   import { cleanDescription } from "./title-clean.mjs";
        #   const { cleanDescription } = await import("./title-clean.mjs");   <- dynamic
        #   const cleanTitle = CLEAN.cleanTitle;                            <- namespace alias
        #   function cleanDescription(...) {}                               <- local
        # The declarator name must be the symbol ITSELF. An earlier version
        # used `const[^;]*\bsym\b`, which also matched `const x = deemoji(…)` —
        # the exact unbound call it was meant to catch.
        if re.search(r"(?:const|let|var)\s*\{[^}]*\b" + re.escape(sym) + r"\b", src):
            continue
        if re.search(r"(?:const|let|var)\s+" + re.escape(sym) + r"\b", src):
            continue
        note("MED", f"{f}: calls {sym}() with no binding")

# 3. Every .mjs must parse.
for f in sorted(os.listdir(D)):
    if f.endswith(".mjs"):
        r = subprocess.run(["node", "--check", D + f], capture_output=True)
        if r.returncode:
            note("HIGH", f"{f}: syntax error — {r.stderr.decode()[:120]}")

# 4. The frontend must strip emoji AFTER unescaping, or &#128512; survives.
#    The check looks for the CALL inside sanitizeField specifically. Scanning the
#    whole file for the word "deemoji" found the explanatory COMMENT first and
#    passed a file whose call had been deleted — the mutation test caught it.
web = open(WEB, encoding="utf8").read()
san = re.search(r"function sanitizeField\([^)]*\)\s*\{(.*?)\n\}", web, re.S)
if san:
    # Strip comments before looking. The body contains the sentence "…by the
    # time deemoji() sees it", which matches every plausible call pattern — so
    # checking the raw body passed a file whose actual deemoji() call had been
    # deleted. Comments are prose about the call; only code counts.
    body = re.sub(r"//[^\n]*", "", san.group(1))
    call = re.search(r"(?<![\w.$])deemoji\s*\(", body)
    i_u = re.search(r"(?<![\w.$])unsource\s*\(", body)
    if not call:
        note("HIGH", "sanitizeField no longer calls deemoji")
    elif i_u and call.start() < i_u.start():
        note("HIGH", "deemoji runs BEFORE unsource — &#128512; would survive")
    else:
        print("  ok  sanitizeField calls deemoji, after unsource")
else:
    note("MED", "could not locate sanitizeField in index.html")

# 5. Both live feeds: shape + the invariants the page relies on.
for f, city in [("events.json", "San Francisco"), ("dc-events.json", "Washington")]:
    p = "/var/www/pinkpages.indigokarasu.com/" + f
    if not os.path.exists(p):
        note("HIGH", f"{f} missing from web root")
        continue
    d = json.load(open(p))
    ev = d["events"]
    if not ev:
        note("HIGH", f"{f}: zero events")
    ids = [e["id"] for e in ev]
    if len(ids) != len(set(ids)):
        note("MED", f"{f}: duplicate ids ({len(ids)-len(set(ids))})")
    for e in ev:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", e.get("date", "")):
            note("HIGH", f"{f}: bad date on {e.get('id')}"); break
        if not e.get("url"):
            note("HIGH", f"{f}: row without url: {e.get('id')}"); break
        if not e.get("categories"):
            note("MED", f"{f}: row without categories: {e.get('id')}"); break
    if len({e["date"] for e in ev}) > 4:
        note("MED", f"{f}: window spans {len({e['date'] for e in ev})} days, expected <=4")
    print(f"  ok  {f}: {len(ev)} events, ids unique, dates+urls present")

# 6. A stale copy of the SF scraper must not be the one on disk in two places.
for dup in ["fetch.mjs.bak", "fetch.mjs.backup"]:
    if os.path.exists(D + dup):
        note("LOW", f"stale scraper copy present: {dup}")

print()
if findings:
    print(f"CHANGES REQUESTED — {len(findings)} finding(s)")
    sys.exit(1)
print("CLEAN — no findings")
sys.exit(0)