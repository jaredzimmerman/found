#!/usr/bin/env bash
# Run every OFFLINE check for the whattodo72 build. Exit 0 only if all pass.
# Runnable from any cwd; works on node 22 (Mac) and node 18 (DreamHost).
#
# Stages: (a) node --check every build/*.mjs, (b) bash -n every *.sh,
# (c) every offline test file, (d) import-completeness gate (test-imports).
#
# Offline test files run: build/test-*.mjs (except test-imports, which is stage d)
# plus any tests/*.test.mjs and tests/*.test.sh that exist.
#
# EXCLUDED (network or live-state), by design:
#   tests/replay/run.sh  - replays recorded fixtures through the full scraper
#                          (own acceptance command, needs recorded fixtures)
#   (no build/test-*.mjs currently needs the network; test-foopee and
#    test-citylights run the real parsers against tests/fixtures/*.)
# A test that cannot run offline must be listed here with its reason.
#
# Safety net: nothing in this runner may run the scraper. If build/events.json
# is (re)written while the tests run, some test imported fetch.mjs (which runs
# main(): a full network scrape) and the runner fails.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
TOTAL=0
STAMP="$(mktemp "${TMPDIR:-/tmp}/run-all-stamp.XXXXXX")"
trap 'rm -f "$STAMP" "$STAMP.out"' EXIT
sleep 1; touch "$STAMP"

echo "node $(node -v)  root $ROOT"

# (a) syntax-check every build module
for f in build/*.mjs; do
  TOTAL=$((TOTAL + 1))
  if err="$(node --check "$f" 2>&1)"; then
    :
  else
    FAILED=$((FAILED + 1)); echo "FAIL node --check $f"; echo "$err" | sed 's/^/    /'
  fi
done
echo "done  node --check build/*.mjs"

# (b) syntax-check every shell script
while IFS= read -r f; do
  TOTAL=$((TOTAL + 1))
  if err="$(bash -n "$f" 2>&1)"; then
    :
  else
    FAILED=$((FAILED + 1)); echo "FAIL bash -n $f"; echo "$err" | sed 's/^/    /'
  fi
done < <(find . \( -name .git -o -name node_modules -o -name .ladder -o -name fixtures \) -prune -o -name '*.sh' -type f -print | sort)
echo "done  bash -n *.sh"

# (c) run each offline test file
count_checks() { # $1 = output file
  local n
  n="$(sed -n 's/^\([0-9][0-9]*\) passed, \([0-9][0-9]*\) failed.*/\1 \2/p' "$1" | tail -1)"
  if [ -n "$n" ]; then echo $(( ${n% *} + ${n#* } )); return; fi
  grep -cE '^[[:space:]]+(ok|FAIL)[[:space:]]' "$1"
}
run_test() { # $1 = file, $2... = command
  local file="$1"; shift
  TOTAL=$((TOTAL + 1))
  if "$@" >"$STAMP.out" 2>&1; then
    echo "PASS $file ($(count_checks "$STAMP.out") checks)"
  else
    FAILED=$((FAILED + 1))
    echo "FAIL $file ($(count_checks "$STAMP.out") checks)"
    sed 's/^/    /' "$STAMP.out" | tail -40
  fi
}
for f in build/test-*.mjs tests/*.test.mjs; do
  [ -f "$f" ] || continue
  [ "$f" = "build/test-imports.mjs" ] && continue
  run_test "$f" node "$f"
done
for f in tests/*.test.sh; do
  [ -f "$f" ] || continue
  run_test "$f" bash "$f"
done

# (d) import-completeness gate
TOTAL=$((TOTAL + 1))
if node build/test-imports.mjs build >"$STAMP.out" 2>&1; then
  echo "PASS build/test-imports.mjs ($(grep -c ' -> ' "$STAMP.out") imports)"
else
  FAILED=$((FAILED + 1)); echo "FAIL build/test-imports.mjs"; sed 's/^/    /' "$STAMP.out" | tail -40
fi

# safety net: the tests must never run the scraper
if [ -e build/events.json ] && [ build/events.json -nt "$STAMP" ]; then
  FAILED=$((FAILED + 1)); TOTAL=$((TOTAL + 1))
  echo "FAIL a test ran the scraper: build/events.json was rewritten (some test imported fetch.mjs, which runs main())"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "ALL PASS: $TOTAL checks/files"
  exit 0
fi
echo "FAILED: $FAILED of $TOTAL"
exit 1
