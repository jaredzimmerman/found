"""Mutation test for cycle.py: break each invariant it claims to guard, confirm
it reports the finding, then restore.

A checker that passes is worthless if it cannot fail. Each mutation below is
applied to a throwaway copy of the tree's logic, never to live files, and the
file is restored immediately after.
"""
import os, re, shutil, subprocess, sys

D = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/"
WEB = "/var/www/pinkpages.indigokarasu.com/index.html"
WEB_BAK = WEB + ".mutbak"
CYCLE = D + "cycle.py"
results = []


def run():
    r = subprocess.run(["python3", CYCLE], capture_output=True, text=True)
    return r.stdout + r.stderr


def expect(label, needle, should_appear):
    out = run()
    found = needle in out
    ok = (found == should_appear)
    results.append((label, ok, needle, found))
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}: expected {needle} "
          f"{'present' if should_appear else 'absent'}, was "
          f"{'present' if found else 'absent'}")


baseline = run()
assert "CLEAN" in baseline, f"baseline is not clean:\n{baseline}"
print("  ok  baseline is CLEAN")

# --- M1: reorder sanitizeField so deemoji precedes unsource ---------------
shutil.copy2(WEB, WEB_BAK)
try:
    src = open(WEB, encoding="utf8").read()
    m = re.search(r"(function sanitizeField\([^)]*\)\s*\{)(.*?)(\n\})", src, re.S)
    body = m.group(2)
    # put deemoji first, unsource second — the ordering that lets &#128512; through
    i_u, i_d = body.find("unsource"), body.find("deemoji")
    nu = re.sub(r"[^\n]*unsource[^\n]*\n", "", body, count=1)
    nd = re.sub(r"[^\n]*deemoji[^\n]*\n", "", nu, count=1)
    swapped = m.group(1) + nd + "const _x = unsource(v);\n" + m.group(3)
    open(WEB, "w", encoding="utf8").write(src[:m.start()] + swapped + src[m.end():])
    expect("M1 deemoji-before-unsource detected", "deemoji runs BEFORE unsource", True)
finally:
    shutil.move(WEB_BAK, WEB)

# --- M2: drift a cleaning rule back into ONE city's copy ----------------
#    The mutation must survive the regex/str masking that check #1 applies,
#    or it proves nothing. So it adds a rule to the SF module that is NOT a
#    regex or a string — a behavioural difference in code shape.
tc = D + "title-clean.mjs"
shutil.copy2(tc, tc + ".mutbak")
try:
    src = open(tc, encoding="utf8").read()
    # append a rule the DC copy does not have
    src = src.rstrip() + "\n\nexport const SF_ONLY_RULE = true;\n"
    open(tc, "w", encoding="utf8").write(src)
    expect("M2 per-city rule drift detected", "differ in LOGIC", True)
finally:
    shutil.move(tc + ".mutbak", tc)

# --- M3: remove the emoji strip from sanitizeField ------------------------
#    Delete the CALL specifically. An earlier version removed the first line
#    containing the word "deemoji", which in index.html is an explanatory
#    COMMENT — so the mutation never touched the behaviour it claimed to break.
shutil.copy2(WEB, WEB_BAK)
try:
    src = open(WEB, encoding="utf8").read()
    # Remove the ASSIGNMENT that calls deemoji (`s = deemoji(s);`), not merely
    # any line mentioning it — the explanatory comments mention it too, and
    # deleting a comment changes nothing, which made this mutation lie.
    mutated, n = re.subn(r"^[ \t]*\w+[ \t]*=[ \t]*deemoji\s*\([^\n]*\n",
                         "", src, count=1, flags=re.M)
    assert n == 1, "M3 mutation did not apply — no `x = deemoji(...)` found"
    open(WEB, "w", encoding="utf8").write(mutated)
    expect("M3 deemoji removed detected", "no longer calls deemoji", True)
finally:
    shutil.move(WEB_BAK, WEB)

# --- M4: a feed row missing its url --------------------------------------
sj = "/var/www/pinkpages.indigokarasu.com/dc-events.json"
shutil.copy2(sj, sj + ".mutbak")
try:
    import json
    d = json.load(open(sj))
    d["events"][0]["url"] = ""
    json.dump(d, open(sj, "w"))
    expect("M4 url-less row detected", "row without url", True)
finally:
    shutil.move(sj + ".mutbak", sj)

# --- M5: a syntax error in any module ------------------------------------
open(D + "mut-broken.mjs", "w").write("export function oops( {")
try:
    expect("M5 syntax error detected", "syntax error", True)
finally:
    os.remove(D + "mut-broken.mjs")

# --- M6: an unbound call (the emoji bug's actual shape) ------------------
open(D + "mut-unbound.mjs", "w").write(
    "import { cleanTitle } from './title-clean.mjs';\n"
    "export const x = deemoji('hi');\n")
try:
    expect("M6 unbound call detected", "no binding", True)
finally:
    os.remove(D + "mut-unbound.mjs")

print()
bad = [r for r in results if not r[1]]
print(f"{'PASS' if not bad else 'FAIL'} — checker has teeth: "
      f"{len(results)-len(bad)}/{len(results)} mutations caught")
assert "CLEAN" in run(), "tree did not return to clean after mutations"
print("  ok  tree returned to CLEAN after all mutations were reverted")
sys.exit(1 if bad else 0)