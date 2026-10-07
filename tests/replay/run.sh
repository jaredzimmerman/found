#!/usr/bin/env bash
# Offline, deterministic replay of the scrapers against recorded HTTP (PLAN C10).
#
#   bash tests/replay/run.sh                  # replay + compare with tests/golden/
#   bash tests/replay/run.sh --out DIR        # keep normalized outputs + logs in DIR
#   bash tests/replay/run.sh --only fetch|dc  # one scraper only
#   bash tests/replay/run.sh --update-golden  # REWRITE the golden files (explicit only)
#
# Copies build/ (source only, never generated state) to a temp dir, runs
# fetch.mjs and dc-fetch.mjs there under replay-preload.mjs (no network, frozen
# time), normalizes the output (drops generatedAt) and compares it with
# tests/golden/{events,dc-events}.golden.json via compare.mjs.
# Exit 0 = identical; 1 = output differs; 2 = setup error; 3 = a scraper
# crashed or asked for a request that was never recorded (fixture miss).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
GOLDEN_DIR="$REPO/tests/golden"
FIXTURES="${REPLAY_FIXTURES:-$HERE/fixtures}"
UPDATE=0; OUT=""; ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --update-golden) UPDATE=1 ;;
    --out) OUT="${2:?--out needs a dir}"; shift ;;
    --only) ONLY="${2:?--only needs fetch|dc}"; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "run.sh: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done

if [[ ! -f "$FIXTURES/meta.json" ]]; then
  echo "run.sh: no fixtures at $FIXTURES (record with tests/replay/record.sh, or restore" >&2
  echo "        hermes:/root/backups/whattodo72-fixtures-<date>.tgz into tests/replay/; see README)" >&2
  exit 2
fi
FIXTURES="$(cd "$FIXTURES" && pwd)"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/wtd-replay.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
KEEP=1; if [[ -z "$OUT" ]]; then OUT="$WORK/out"; KEEP=0; fi
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"

# Source only: the copy must not see events.json / dc-events.json /
# image-levels.json / dotfiles (PLAN C1), which differ per machine.
mkdir -p "$WORK/build"
rsync -a --exclude='/events.json' --exclude='/dc-events.json' --exclude='/image-levels.json' \
  --exclude='/.*' "$REPO/build/" "$WORK/build/" || { echo "run.sh: copying build/ failed" >&2; exit 2; }
rm -f "$WORK/build/events.json" "$WORK/build/dc-events.json" "$WORK/build/image-levels.json"

logref() { if [[ $KEEP -eq 0 ]]; then echo "rerun with --out DIR to keep the log"; else echo "log: $OUT/$1.log"; fi; }

status=0
run_one() { # name script output golden
  local name="$1" script="$2" produced="$3" golden="$GOLDEN_DIR/$4"
  local misses="$OUT/$name.misses"
  rm -f "$misses"
  ( cd "$WORK/build" && TZ=America/Los_Angeles REPLAY_FIXTURES="$FIXTURES" REPLAY_MISSES="$misses" \
      REPLAY_FAST="${REPLAY_FAST:-1}" node --import "$HERE/replay-preload.mjs" "$script" ) > "$OUT/$name.log" 2>&1
  local rc=$?
  if [[ -s "$misses" ]]; then
    echo "[$name] FAIL: $(wc -l < "$misses" | tr -d ' ') request(s) not in the fixtures (first: $(head -1 "$misses"))"
    echo "        re-record (tests/replay/record.sh) if the code now asks for new URLs; $(logref "$name")"
    status=3; return
  fi
  if [[ $rc -ne 0 || ! -f "$WORK/build/$produced" ]]; then
    echo "[$name] FAIL: $script exited $rc without a usable $produced; last lines of the log:"
    tail -15 "$OUT/$name.log" | sed 's/^/        /'
    status=3; return
  fi
  node "$HERE/compare.mjs" --normalize "$WORK/build/$produced" "$OUT/$name.normalized.json" || { status=2; return; }
  if [[ $UPDATE -eq 1 ]]; then
    mkdir -p "$GOLDEN_DIR"
    cp "$OUT/$name.normalized.json" "$golden"
    echo "[$name] golden REWRITTEN: $golden ($(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).events.length)' "$golden") events)"
    return
  fi
  if [[ ! -f "$golden" ]]; then
    echo "[$name] FAIL: no golden at $golden (create it with --update-golden)"; status=2; return
  fi
  echo "[$name] $(node "$HERE/compare.mjs" "$golden" "$OUT/$name.normalized.json" | head -200)"
  if ! cmp -s "$golden" "$OUT/$name.normalized.json"; then
    [[ $status -eq 0 ]] && status=1
    echo "[$name] FAIL: normalized output differs from $golden"
  fi
}

[[ -z "$ONLY" || "$ONLY" == "fetch" ]] && run_one events fetch.mjs events.json events.golden.json
[[ -z "$ONLY" || "$ONLY" == "dc" ]] && run_one dc-events dc-fetch.mjs dc-events.json dc-events.golden.json

if [[ $status -eq 0 ]]; then
  where=""; [[ $KEEP -eq 0 ]] || where="; outputs in $OUT"
  echo "replay OK (fixtures: $(node -e 'const m=require(process.argv[1]);console.log(m.count+" recorded "+m.recordedAt)' "$FIXTURES/meta.json"))$where"
fi
exit $status
