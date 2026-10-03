"""Was my earlier "zero unused exports" result meaningful?

Re-run the same question with the definition line EXCLUDED from usage. If a
symbol counts as "used" merely because its own `export function foo()` line
contains the word foo, the check is tautological — it cannot fail.
"""
import os, re

BASE = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/"
files = [f for f in sorted(os.listdir(BASE)) if f.endswith(".mjs")]

exported = {}   # file -> [symbols]
for f in files:
    src = open(BASE + f, encoding="utf8").read()
    syms = set(re.findall(
        r"export\s+(?:async\s+)?(?:function\s+|const\s+|let\s+|class\s+)([A-Za-z_$][\w$]*)", src))
    for m in re.findall(r"export\s*\{([^}]+)\}", src):
        for part in m.split(","):
            part = part.strip()
            if part:
                syms.add(part.split(" as ")[0].strip())
    exported[f] = syms

# Usage: every file, but with import/export lines stripped, so a symbol's own
# declaration does not count as a use of itself.
uses = {f: set() for f in files}
allsyms = set().union(*exported.values())
for f in files:
    src = open(BASE + f, encoding="utf8").read()
    body = re.sub(r"^\s*(?:import|export)[^;\n]*;?", "", src, flags=re.M)
    body = re.sub(r"//[^\n]*", "", body)
    for s in allsyms:
        if re.search(r"(?<![\w.$])" + re.escape(s) + r"\b", body):
            uses[f].add(s)

unused = {}
for f, syms in exported.items():
    dead = set()
    for s in syms:
        # a use anywhere OTHER than its own declaration line
        hit = False
        for other in files:
            if s in uses[other]:
                hit = True
                break
        # strip own declaration: count only if used in a file that isn't the
        # declaration, OR appears >1 time in its own file
        if not hit:
            dead.add(s)
    if dead:
        unused[f] = sorted(dead)

total = sum(len(v) for v in exported.values())
totaldead = sum(len(v) for v in unused.values())
print(f"exported symbols total: {total}")
print(f"exported symbols never referenced (declaration excluded): {totaldead}\n")
for f, syms in sorted(unused.items(), key=lambda kv: -len(kv[1])):
    print(f"  {f}: {syms}")