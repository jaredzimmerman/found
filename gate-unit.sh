#!/usr/bin/env bash
# Test /usr/local/bin/pinkpages-gate directly. The gate is a standalone script
# precisely so this is possible: testing it through a full scrape would mean the
# real fetch.mjs overwrites the injected bad build before the gate ever reads it.
set -uo pipefail
GATE=/usr/local/bin/pinkpages-gate
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

evs() { node -e 'const n=+process.argv[1];console.log(JSON.stringify({events:Array.from({length:n},(_,i)=>({id:String(i)})),days:[]}))' "$1"; }

ok=0; bad=0
check() { # label expected_rc candidate [live]
  local label="$1" want="$2" f="$3"
  if [ $# -ge 4 ]; then "$GATE" "$f" "$4" >"$T/out" 2>&1; else "$GATE" "$f" >"$T/out" 2>&1; fi
  local rc=$?
  if [ "$rc" = "$want" ]; then
    echo "  PASS  $label (rc=$rc) $(head -c 58 "$T/out")"; ok=$((ok+1))
  else
    echo "  FAIL  $label expected rc=$want got rc=$rc"; bad=$((bad+1))
  fi
}

evs 79 > "$T/live.json"
evs 0  > "$T/empty.json"
evs 19 > "$T/fragment.json"
evs 39 > "$T/borderline.json"
evs 41 > "$T/above.json"
evs 79 > "$T/same.json"
evs 200 > "$T/grow.json"
printf 'not json' > "$T/junk.json"

check "empty build refused"          1 "$T/empty.json"  "$T/live.json"
check "fragment 19 of 79 refused"   1 "$T/fragment.json" "$T/live.json"
check "just under half refused"     1 "$T/borderline.json" "$T/live.json"
check "just over half accepted"     0 "$T/above.json"  "$T/live.json"
check "equal size accepted"         0 "$T/same.json"   "$T/live.json"
check "a busier day accepted"       0 "$T/grow.json"   "$T/live.json"
check "unparseable build refused"   1 "$T/junk.json"   "$T/live.json"
check "missing build refused"       1 "$T/nope.json"   "$T/live.json"
check "empty live listing accepted" 0 "$T/same.json"   "$T/empty.json"
check "first deploy accepted"       0 "$T/same.json"

echo
echo "gate: $ok passed, $bad failed"
[ "$bad" -eq 0 ]
