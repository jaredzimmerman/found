#!/usr/bin/env bash
# Checks that the docs exist and contain the facts they must state (T02 acceptance).
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0
need() { if [ ! -f "$1" ]; then echo "MISSING: $1"; fail=1; fi; }
has()  { if ! grep -qF -- "$2" "$1" 2>/dev/null; then echo "NOT FOUND in $1: $2"; fail=1; fi; }
need README.md
need docs/ARCHITECTURE.md
need docs/AGENTS.md
for s in 'build-site.sh' 'test/build' 'dh-backup' 'node 18'; do has docs/ARCHITECTURE.md "$s"; done
has docs/AGENTS.md 'scrape.mjs'
if ! grep -q 'not' docs/AGENTS.md 2>/dev/null; then echo "NOT FOUND in docs/AGENTS.md: word 'not'"; fail=1; fi
if [ "$fail" -eq 0 ]; then echo "check-docs: ok"; fi
exit "$fail"
