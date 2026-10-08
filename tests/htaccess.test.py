#!/usr/bin/env python3
"""The .htaccess must keep build inputs, backups and staged deploys off the web.
Checks the RedirectMatch / FilesMatch patterns against sample URL paths (Python's
re is close enough to Apache's PCRE for these simple anchored patterns)."""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
text = open(os.path.join(HERE, "..", ".htaccess"), encoding="utf-8").read()
redirects = [re.compile(m) for m in re.findall(r"^RedirectMatch\s+\d+\s+(\S+)", text, re.M)]
files = [re.compile(m) for m in re.findall(r'<FilesMatch\s+"([^"]+)"\s*>\s*\n\s*Require all denied', text)]
passed = failed = 0

def blocked(path):
    base = path.rsplit("/", 1)[-1]
    return any(r.search(path) for r in redirects) or any(f.search(base) for f in files)

def check(name, cond):
    global passed, failed
    if cond: passed += 1
    else:
        failed += 1; print("  FAIL", name)

for p in ["/test/build/fetch.mjs", "/test/logs/status.json", "/test/build.prev-20261007T120000Z/index.html",
          "/test/build.prev-20261007T120000Z/venue-catalog.json", "/test/.deploy/abc123/docs/ARCHITECTURE.md",
          "/test/_archive-20261007/x.json", "/test/fetch.mjs", "/test/fetch.mjs.pre-valkyries-20261007-144443",
          "/test/build-site.sh", "/test/build-site.sh.bak-20261003", "/test/run-levels.sh", "/test/pinkpages-levels.orig",
          "/test/.fetch.log", "/test/something.py", "/test/x.log", "/test/history.jsonl", "/test/foo.tmp"]:
    check(f"blocked: {p}", blocked(p))
for p in ["/test/events.json", "/test/index.html", "/test/image-levels.json", "/test/favicon.svg",
          "/test/social-share.png", "/test/fonts/archivo-latin.woff2", "/test/prices-resolved.json", "/test/"]:
    check(f"served: {p}", not blocked(p))
check("found redirect rules", len(redirects) >= 4)
check("found FilesMatch rule", len(files) >= 1)
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
