#!/usr/bin/env bash
# Record HTTP fixtures for the replay harness (PLAN C10).
#
#   bash tests/replay/record.sh            # from the Mac: does everything below
#   bash tests/replay/record.sh --local D  # on DreamHost, inside a temp copy of build/
#
# Remote mode (default) ships this tree's build/ sources plus tests/replay/ to a
# fresh $HOME/wtd-replay-rec-<ts>/ on DreamHost (via `ssh hermes` then
# `ssh dh-backup`, the only route), runs fetch.mjs and dc-fetch.mjs there under
# record-preload.mjs with node 18 so the recording matches prod egress, pulls
# fixtures/ back to tests/replay/fixtures/ (gitignored), keeps a tarball at
# hermes:/root/backups/whattodo72-fixtures-<date>.tgz and removes the remote
# temp dir. It never touches ~/whattodo72.com and never runs build-site.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

if [[ "${1:-}" == "--local" ]]; then
  OUT="${2:?usage: record.sh --local FIXTURES_DIR}"
  case "$PWD/" in
    "$HOME/whattodo72.com/"*) echo "record.sh: refusing to record inside the live tree ($PWD)" >&2; exit 2 ;;
  esac
  [[ -f fetch.mjs && -f dc-fetch.mjs ]] || { echo "record.sh --local: run inside a copy of build/" >&2; exit 2; }
  mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
  export TZ=America/Los_Angeles
  export REPLAY_FIXTURES="$OUT"
  # One frozen "now" for both scripts, so their window days agree.
  REPLAY_NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"; export REPLAY_NOW
  recordedAt="$REPLAY_NOW"
  rc_fetch=0; rc_dc=0
  timeout 20m node --import "$HERE/record-preload.mjs" fetch.mjs > "$OUT/_fetch.log" 2>&1 || rc_fetch=$?
  timeout 10m node --import "$HERE/record-preload.mjs" dc-fetch.mjs > "$OUT/_dc-fetch.log" 2>&1 || rc_dc=$?
  [[ -f events.json ]] && cp events.json "$OUT/_recorded-events.json"
  [[ -f dc-events.json ]] && cp dc-events.json "$OUT/_recorded-dc-events.json"
  count=$(find "$OUT" -maxdepth 1 -name '[0-9a-f]*.json' | wc -l | tr -d ' ')
  cat > "$OUT/meta.json" <<JSON
{"frozenNow":"$REPLAY_NOW","recordedAt":"$recordedAt","nodeVersion":"$(node --version)","tz":"$TZ","count":$count,"exit":{"fetch":$rc_fetch,"dc-fetch":$rc_dc},"host":"$(hostname)"}
JSON
  echo "recorded $count fixtures (fetch exit $rc_fetch, dc-fetch exit $rc_dc) into $OUT"
  [[ $rc_fetch -eq 0 && $rc_dc -eq 0 ]]
  exit $?
fi

# ---------------------------------------------------------------- remote mode
STAMP="$(date +%Y%m%d%H%M%S)"
DAY="$(date +%Y%m%d)"
RDIR="wtd-replay-rec-$STAMP"
DH() { ssh -o BatchMode=yes hermes "ssh -o BatchMode=yes dh-backup $(printf '%q' "$1")"; }

echo "== shipping build/ sources + tests/replay to dh:~/$RDIR"
# Source only: generated state (C1) stays out, so the recording runs the code
# in this tree, not whatever is lying around on the host.
COPYFILE_DISABLE=1 tar -C "$REPO" -cz \
  --exclude='build/events.json' --exclude='build/dc-events.json' \
  --exclude='build/image-levels.json' --exclude='build/.*' \
  --exclude='tests/replay/fixtures' --exclude='tests/replay/out' \
  build tests/replay \
  | DH "mkdir -p \"\$HOME/$RDIR\" && tar -xz -C \"\$HOME/$RDIR\""

echo "== recording on DreamHost (node 18; this takes several minutes)"
set +e
DH "cd \"\$HOME/$RDIR/build\" && bash ../tests/replay/record.sh --local ../fixtures"
rc=$?
set -e

echo "== pulling fixtures back"
mkdir -p "$HERE"
rm -rf "$HERE/fixtures.new"
mkdir -p "$HERE/fixtures.new"
DH "tar -cz -C \"\$HOME/$RDIR\" fixtures" | tar -xz -C "$HERE/fixtures.new"
rm -rf "$HERE/fixtures"
mv "$HERE/fixtures.new/fixtures" "$HERE/fixtures"
rmdir "$HERE/fixtures.new"

TGZ="whattodo72-fixtures-$DAY.tgz"
tar -C "$HERE" -czf "$HERE/../../$TGZ.tmp" fixtures
ssh -o BatchMode=yes hermes "mkdir -p /root/backups && cat > /root/backups/$TGZ" < "$HERE/../../$TGZ.tmp"
rm -f "$HERE/../../$TGZ.tmp"
echo "== tarball kept at hermes:/root/backups/$TGZ"

DH "rm -rf \"\$HOME/$RDIR\""

n=$(find "$HERE/fixtures" -maxdepth 1 -name '[0-9a-f]*.json' | wc -l | tr -d ' ')
sz=$(du -sh "$HERE/fixtures" | cut -f1)
echo "fixtures: $n files, $sz total; remote record exit $rc"
exit $rc
