#!/usr/bin/env bash
# ONE 10xeng scan. Exit 0 only if every gate passes.
#
# The point of the loop is that "clean" is a claim about a whole run, not about
# one probe. So each scan re-runs every gate from scratch and reports a single
# verdict. Anything that can pass while the feed is wrong is a failed gate.
#
# Gates:
#   1. unit suite, every file          — parser contracts
#   2. feed invariants, both cities    — every row's required fields
#   3. no emoji / styling markers      — global, not per-source
#   4. city integrity                  — no SF hood in DC, no DC hood in SF
#   5. SCRAP live parse                — the source just added, against the real page
#   6. live verification               — the published URLs answer 200
set -uo pipefail
cd "$(dirname "$0")" || exit 99

FAIL=0
note() { printf '  %-46s %s\n' "$1" "$2"; }
bad()  { printf '  %-46s FAIL  %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }

echo "=================================================================="
echo "SCAN $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "=================================================================="

# -- 1. unit suite -------------------------------------------------------
pass=0; fail=0; failed=""
for t in test-*.mjs; do
  [ -e "$t" ] || continue
  log="/tmp/scan-$(basename "$t").log"
  if node "$t" >"$log" 2>&1; then pass=$((pass+1)); else
    fail=$((fail+1)); failed="$failed $t"; echo "      --- $t ---"
    grep -E "FAIL|Error|error:" "$log" | head -8 | sed 's/^/        /'; fi
done
for p in test-*.py; do
  [ -e "$p" ] || continue
  log="/tmp/scan-$(basename "$p").log"
  if python3 "$p" >"$log" 2>&1; then pass=$((pass+1)); else
    fail=$((fail+1)); failed="$failed $p"; echo "      --- $p ---"
    grep -E "FAIL|Error|error:|AssertionError" "$log" | head -8 | sed 's/^/        /'; fi
done
if [ "$fail" -eq 0 ]; then note "unit suite ($pass files)" "ok"
else bad "unit suite" "$fail file(s):$failed"; fi

# -- 2,3,4. feed invariants + emoji + city integrity ---------------------
if out=$(python3 verify-live.py 2>&1); then
  note "feed invariants, emoji, city integrity" "ok"
  echo "$out" | grep -E "events|violations|dup|emoji|SF/DC|city" | sed 's/^/      /'
else
  bad "feed invariants / emoji / city integrity"
  echo "$out" | tail -20 | sed 's/^/      /'
fi

# -- 5. SCRAP against the live page --------------------------------------
if [ -s /tmp/scrap.html ]; then
  if out=$(node probes/scrap-live-check.mjs /tmp/scrap.html 2>&1); then
    d=$(echo "$out" | grep -oE 'parsed [0-9]+' | head -1)
    note "SCRAP live parse (${d:-?})" "ok"
  else
    bad "SCRAP live parse"; echo "$out" | tail -8 | sed 's/^/      /'
  fi
  if out=$(node probes/scrap-publish-proof.mjs /tmp/scrap.html 2>&1); then
    note "SCRAP publish proof" "ok"
  else
    bad "SCRAP publish proof"; echo "$out" | tail -8 | sed 's/^/      /'
  fi
else
  note "SCRAP live parse" "skipped (no cached page)"
fi

# -- 6. published feed answers, and is the SAME BUILD we just made ----------
for u in https://datebook.indigokarasu.com/events.json \
         https://datebook.indigokarasu.com/dc-events.json; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$u")
  if [ "$code" = "200" ]; then note "$u" "200"; else bad "$u" "HTTP $code"; fi
done

# A 200 proves the file exists, not that it is today's build. Compare the live
# bytes against the local build: if they differ the publish step did not run, and
# every other gate above would have passed anyway — a stale feed is exactly the
# failure that a status-code check cannot see.
loc_ev=$(wc -c < events.json)
live_ev=$(curl -s --max-time 25 https://datebook.indigokarasu.com/events.json | wc -c)
if [ "$loc_ev" = "$live_ev" ]; then
  note "live feed is the current build ($loc_ev b)" "ok"
else
  bad "live feed vs local build" "local $loc_ev b != live $live_ev b — not published"
fi
if [ -f dc-events.json ]; then
  loc_dc=$(wc -c < dc-events.json)
  live_dc=$(curl -s --max-time 25 https://datebook.indigokarasu.com/dc-events.json | wc -c)
  if [ "$loc_dc" = "$live_dc" ]; then note "live DC feed is current ($loc_dc b)" "ok"
  else bad "live DC feed vs local build" "local $loc_dc b != live $live_dc b — not published"; fi
fi

echo "------------------------------------------------------------------"
if [ "$FAIL" -eq 0 ]; then echo "SCAN CLEAN"; exit 0
else echo "SCAN DIRTY — $FAIL gate(s) failed"; exit 1; fi
