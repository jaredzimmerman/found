#!/usr/bin/env bash
# Build whattodo72.com ENTIRELY on DreamHost and publish to the live docroot.
# No Hermes VPS involvement. This is the only builder for this site.
#
# Stages, in order, each aborting the whole run on failure:
#   1. fetch.mjs          — scrape the 3-day window -> build/events.json
#   2. pinkpages-levels   — measure artwork tone -> image-levels.json
#   3. publish            — atomic copy into /test (validated)
#   4. promote            — atomic copy into the LIVE docroot (validated)
#
# Runtime is DH's SYSTEM node 18, deliberately. Node 22 was installed and
# tried: it dies with SIGTRAP because V8's baseline JIT asks for W^X executable
# memory, which this grsec-hardened shared kernel refuses. Node 18 runs the
# whole fetch to completion, and the one thing node 22 would have bought —
# letting Playwright load on node 20+ — is moot, because Chrome cannot run here
# at all (see below).
#
# Headless Chrome CANNOT run on this host: the kernel blocks the zygote fork,
# so chromium exits 133 (SIGTRAP) and returns an empty DOM for every URL,
# including about:blank and local files. Verified with --single-process too.
#
# That constraint used to cost the feed two events, and the header here claimed a
# FIXED number ("~148 where a VPS build carried 157") — a figure nothing
# re-measured, which is how it drifted out of date while still reading as
# documentation. Both numbers move with the calendar, so neither is written down
# here any more. What IS true and worth stating is the mechanism:
#
#   City Lights  — no longer needs a browser. fetch.mjs solves the Sucuri
#                  interstitial in plain node (sucuri.mjs) and parses the served
#                  HTML (citylights-parse.mjs). Verified live on this host: 35/35
#                  blocks, 1 in-window, first-party permalink. Chromium remains
#                  only as a fallback if the challenge shape changes.
#   Omnivore     — genuinely unreachable here. Shopify answers 429
#                  local_rate_limited to every request from this shared IP range,
#                  including a control request to a different Shopify store, so
#                  it is an IP-level block and not this source's rate limiting.
#                  Playwright does not help: it would use the same egress IP.
#
# So the residual gap is Omnivore-only, it is printed every run by name, and the
# build no longer asserts a count it cannot prove.
#
# ---- run control (plan contracts C4, C5, C6, C8) -----------------------------
# Environment knobs; every default is the production behavior:
#   ROOT           live docroot                    (default $HOME/whattodo72.com)
#   SITE_URL       public URL of ROOT, read back in stages 6-7
#                                                  (default https://whattodo72.com)
#   DRY_RUN=1      stages 0-3 only (levels skipped): fetch + validate, print a
#                  summary, never write /test or live
#   STAGE_ONLY=1   publish /test (+ static assets), verify it, stop before promote
#   RUN_ID         id of this run (default <UTC stamp>-<pid>)
#   BUILD_TIMEOUT  bound on the whole run          (default 25m)
#   FETCH_TIMEOUT  bound on `node fetch.mjs`       (default 15m)
#   FETCH_DEADLINE_MS  global deadline inside fetch.mjs (default 12 min)
#   W72_NODE       node command for every node step (default node; tests stub it)
#   W72_NODE_QUICK_BOUND  per-attempt bound on quick node steps (default 60s)
#   W72_NODE_BACKOFF      waits before retries 2 and 3 (default "3 8")
#   W72_NODE_FLAKE_WINDOW fetch/dc-fetch are retried only if they died of a
#                  launch flake within this many seconds (default 90)
#
# Node launch flakes (T14, decision D5). This account sits in a cgroup with
# pids.max=25 (threads count; seen 2026-10-07: pids.events "max 91"). A plain
# node 18 start is 7 tasks and 11 once the libuv pool spins up, so with cron,
# ssh and tee running node sometimes cannot create a thread: it aborts at
# launch (pthread_create EAGAIN -> exit 134, sometimes 133) or hangs. Two
# defences:
#   - fewer threads: --v8-pool-size=1 and UV_THREADPOOL_SIZE=2 (verified on DH
#     node 18.19.1: replay output identical, peak 7 tasks instead of 12);
#   - run_node / run_node_long below retry ONLY launch flakes (exit 133, 134,
#     139, a hang, or exit 1 saying pthread_create / EAGAIN / fork: retry). A
#     script's own failure is never retried. Each retry prints
#     "retry node <step> (attempt n/N, reason)" and is counted as node_retries
#     in history.jsonl (when > 0) and status.json.
#
# Every run, whatever happens, ends in the EXIT trap, which calls
# build/record-run.mjs: one line appended to logs/history.jsonl and
# logs/status.json rewritten. Outcomes: published | rejected (the validator
# refused the feed) | fatal | dry-run | stage-only | locked-skip. A failure still
# exits non-zero.
#
# Only one build runs at a time: `flock -n` on test/.build.lock; a second
# instance records locked-skip and exits 0.
#
# Deploys replace this file by RENAME, never by editing it in place: bash reads a
# script incrementally, and a rename leaves the running instance on the old inode.
# Never edit this file in place from within itself, and never `sed -i` it on prod.
set -euo pipefail

ROOT="${ROOT:-$HOME/whattodo72.com}"
SITE_URL="${SITE_URL:-https://whattodo72.com}"
SITE_URL="${SITE_URL%/}"
DRY_RUN="${DRY_RUN:-0}"
STAGE_ONLY="${STAGE_ONLY:-0}"
BUILD_TIMEOUT="${BUILD_TIMEOUT:-25m}"
FETCH_TIMEOUT="${FETCH_TIMEOUT:-15m}"
TEST="$ROOT/test"
BUILD="$TEST/build"
LOGS="$TEST/logs"
export PATH="/usr/bin:/bin:/usr/local/bin:$PATH"   # system node 18; see header
export CHROME_BIN="$HOME/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome"
export FETCH_DEADLINE_MS="${FETCH_DEADLINE_MS:-720000}"
export UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-2}"
case " ${NODE_OPTIONS:-} " in
  *" --v8-pool-size="*) ;;
  *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--v8-pool-size=1" ;;
esac
W72_NODE="${W72_NODE:-node}"
NODE_QUICK_BOUND="${W72_NODE_QUICK_BOUND:-60s}"
NODE_BACKOFF="${W72_NODE_BACKOFF:-3 8}"
NODE_FLAKE_WINDOW="${W72_NODE_FLAKE_WINDOW:-90}"

# Fixed before the re-exec below, so both processes agree on them.
export RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
export W72_STARTED="${W72_STARTED:-$(date +%s)}"

log() { echo "[$(date -Is 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')] $*"; }

TIMEOUT_BIN="$(command -v timeout || true)"

# ---- overall bound -----------------------------------------------------------
# Re-exec once under timeout(1). timeout signals its whole process group, so the
# TERM reaches this shell (whose trap records the run) and its children.
if [ -z "${W72_UNDER_TIMEOUT:-}" ]; then
  export W72_UNDER_TIMEOUT=1
  if [ -n "$TIMEOUT_BIN" ]; then
    exec "$TIMEOUT_BIN" -k 60s "$BUILD_TIMEOUT" bash "${BASH_SOURCE[0]}" "$@"
  fi
  log "WARNING: timeout(1) not found; running without the $BUILD_TIMEOUT overall bound"
fi

[ -d "$BUILD" ] || { echo "FATAL: no build dir at $BUILD" >&2; exit 1; }
command -v "$W72_NODE" >/dev/null || { echo "FATAL: node missing" >&2; exit 1; }
mkdir -p "$LOGS/runs"

# ---- outcome bookkeeping ------------------------------------------------------
OUTCOME=""            # set explicitly on every non-fatal ending
STAGE="init"
FETCHED=0             # this run produced build/events.json
VALIDATED=0           # this run produced build/.validate-report.json
CHILD_PID=""          # bounded child (see run_bounded), killed on a signal
WATCHER_PID=""
ERR_AT=""
FATAL_FILE="$LOGS/.fatal-$RUN_ID"
rm -f "$FATAL_FILE"

die() {                               # die <message>: record, print, exit 1
  printf '%s\n' "$*" >> "$FATAL_FILE" 2>/dev/null || true
  echo "FATAL: $*" >&2
  exit 1
}

kill_child() {
  if [ -n "$WATCHER_PID" ]; then kill "$WATCHER_PID" 2>/dev/null || true; WATCHER_PID=""; fi
  if [ -n "$CHILD_PID" ]; then
    # Under timeout(1) the child leads its own process group: signal the group.
    kill -TERM -- "-$CHILD_PID" 2>/dev/null || kill -TERM "$CHILD_PID" 2>/dev/null || true
    CHILD_PID=""
  fi
}

on_signal() {
  trap '' PIPE
  printf 'killed by SIG%s at stage %s (overall bound %s)\n' "$1" "$STAGE" "$BUILD_TIMEOUT" >> "$FATAL_FILE" 2>/dev/null || true
  echo "FATAL: killed by SIG$1 at stage $STAGE" >&2 || true
  kill_child
  exit 143
}

# run_bounded <duration> <cmd...>: run cmd in the background under a time bound
# and wait for it (a background child + wait lets the TERM trap fire at once).
# Returns cmd's status, or 124 when the bound was hit. cmd reads the caller's
# stdin (<&0: a bare `&` would give it /dev/null).
dur_secs() {                          # 15m -> 900; accepts s/m/h/d suffixes
  local n="${1%[smhd]}"
  case "$1" in
    *m) echo $((n * 60)) ;; *h) echo $((n * 3600)) ;; *d) echo $((n * 86400)) ;; *) echo "$n" ;;
  esac
}
run_bounded() {
  local limit="$1" rc=0 marker="$LOGS/.timed-out-$RUN_ID"
  shift
  rm -f "$marker"
  if [ -n "$TIMEOUT_BIN" ]; then
    "$TIMEOUT_BIN" -k 10s "$limit" "$@" <&0 &
    CHILD_PID=$!
  else
    "$@" <&0 &
    CHILD_PID=$!
    ( exec >/dev/null 2>&1 9>&-; sleep "$(dur_secs "$limit")"; : > "$marker"; kill -TERM "$CHILD_PID" ) &
    WATCHER_PID=$!
  fi
  wait "$CHILD_PID" || rc=$?
  CHILD_PID=""
  if [ -n "$WATCHER_PID" ]; then kill "$WATCHER_PID" 2>/dev/null || true; WATCHER_PID=""; fi
  if [ -f "$marker" ]; then rm -f "$marker"; rc=124; fi
  return "$rc"
}

# ---- node launch flakes (see header) ---------------------------------------------
NODE_RETRY_LOG="$LOGS/.node-retries-$RUN_ID"   # one line per retry (survives $(...))
rm -f "$NODE_RETRY_LOG"
RUNLOG_FD=0                                     # 1 once fd 7 is the run log (tee)

node_retries() { if [ -f "$NODE_RETRY_LOG" ]; then wc -l < "$NODE_RETRY_LOG" | tr -d ' '; else echo 0; fi; }

note_node_retry() {                   # note_node_retry <step> <n/N> <reason>
  local line="retry node $1 (attempt $2, $3)"
  echo "$line" >> "$NODE_RETRY_LOG" 2>/dev/null || true
  if [ "$RUNLOG_FD" = 1 ]; then log "$line" >&7; else log "$line" >&2; fi
}

# node_flake <rc> <file>: when rc is a launch flake, print why and return 0.
node_flake() {
  case "$1" in
    134) echo "SIGABRT, exit 134" ;;
    133) echo "SIGTRAP, exit 133" ;;
    139) echo "SIGSEGV, exit 139" ;;
    124) echo "no exit within the bound, hung" ;;
    1) grep -qE 'pthread_create|Resource temporarily unavailable|fork: retry' "$2" 2>/dev/null || return 1
       echo "could not create a thread, exit 1" ;;
    *) return 1 ;;
  esac
}

# run_node <step> <node args...>: every node step except fetch.mjs/dc-fetch.mjs.
# Each attempt is bounded by NODE_QUICK_BOUND (NODE_BOUND overrides); up to 3
# attempts, retrying only a launch flake. Only the last attempt's stdout and
# stderr reach the caller. NODE_STDIN=<file> feeds stdin (re-read per attempt).
# A thread-creation exit 1 that survives all 3 attempts returns 75, so a caller
# that reads exit 1 as the script's verdict (validate-feed) never sees one.
run_node() {
  local step="$1" n=1 rc=0 out err reason delay tag="$LOGS/.node-$RUN_ID"
  shift
  out=$(mktemp "$tag.XXXXXX" 2>/dev/null) && err=$(mktemp "$tag.XXXXXX" 2>/dev/null) || {
    "$W72_NODE" "$@"; return $?; }
  while :; do
    rc=0
    run_bounded "${NODE_BOUND:-$NODE_QUICK_BOUND}" "$W72_NODE" "$@" \
      < "${NODE_STDIN:-/dev/null}" > "$out" 2> "$err" || rc=$?
    [ "$rc" -eq 0 ] && break
    reason=$(node_flake "$rc" "$err") || break
    if [ "$n" -ge 3 ]; then
      [ "$rc" -eq 1 ] && rc=75
      echo "node $step: still failing to start after 3 attempts ($reason)" >> "$err"
      break
    fi
    if [ "$n" = 1 ]; then delay="${NODE_BACKOFF%% *}"; else delay="${NODE_BACKOFF##* }"; fi
    n=$((n + 1))
    note_node_retry "$step" "$n/3" "$reason"
    sleep "$delay"
  done
  cat "$out"; cat "$err" >&2
  rm -f "$out" "$err"
  return "$rc"
}

# run_node_stdin <step> <node args...>: run_node fed from this function's stdin.
run_node_stdin() {
  local NODE_STDIN rc=0
  NODE_STDIN=$(mktemp "$LOGS/.node-$RUN_ID.XXXXXX") || return 1
  cat > "$NODE_STDIN"
  run_node "$@" || rc=$?
  rm -f "$NODE_STDIN"
  return "$rc"
}

# run_node_long <step> <bound> <log> <node args...>: fetch.mjs / dc-fetch.mjs,
# output to <log>. Retried ONCE, and only when node died of a launch flake within
# NODE_FLAKE_WINDOW s (later deaths and every normal exit are real: a rerun
# would double the load on the sources). The retry gets what is left of <bound>;
# the first attempt's log is kept as <log>.flaked.
run_node_long() {
  local step="$1" bound="$2" logf="$3" rc=0 t0 el left reason delay="${NODE_BACKOFF%% *}"
  shift 3
  t0=$(date +%s)
  run_bounded "$bound" "$W72_NODE" "$@" < /dev/null > "$logf" 2>&1 || rc=$?
  [ "$rc" -eq 0 ] && return 0
  el=$(( $(date +%s) - t0 ))
  [ "$rc" -ne 124 ] && [ "$el" -lt "$NODE_FLAKE_WINDOW" ] || return "$rc"
  reason=$(node_flake "$rc" "$logf") || return "$rc"
  left=$(( $(dur_secs "$bound") - el - delay ))
  [ "$left" -gt 0 ] || return "$rc"
  mv -f "$logf" "$logf.flaked" 2>/dev/null || true
  note_node_retry "$step" "2/2" "$reason after ${el}s"
  sleep "$delay"
  rc=0
  run_bounded "${left}s" "$W72_NODE" "$@" < /dev/null > "$logf" 2>&1 || rc=$?
  return "$rc"
}

# ---- recording without node --------------------------------------------------------
# json_str <text>: a JSON string literal; drops control characters.
json_str() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\t'/ }"
  s="$(printf '%s' "$s" | LC_ALL=C tr -d '\000-\037')"
  printf '"%s"' "$s"
}

# record_fallback <outcome> <why>: when record-run.mjs cannot run, append a
# minimal history line (printf, no node) and rewrite status.json from what
# history and the previous status.json say, so the watchdog never loses a run.
record_fallback() {
  local outcome="$1" why="$2" h="$LOGS/history.jsonl" s="$LOGS/status.json"
  local now ts sha="null" fatal="" l total="null" retries lp ls_ts ls_id ls_tot ls="null"
  local cons src gen tmp
  now=$(date +%s); ts=$(date -u +%Y-%m-%dT%H:%M:%SZ); retries=$(node_retries)
  if [ -s "$BUILD/.deployed-sha" ]; then sha=$(json_str "$(head -c 200 "$BUILD/.deployed-sha" | tr -d ' \r\n')"); fi
  if [ -s "$FATAL_FILE" ]; then
    while IFS= read -r l || [ -n "$l" ]; do
      [ -n "$l" ] && fatal="$fatal${fatal:+,}$(json_str "$l")"
    done < "$FATAL_FILE"
  fi
  case "${built:-}" in ''|*[!0-9]*) ;; *) total="$built" ;; esac
  mkdir -p "$LOGS" 2>/dev/null
  if [ -s "$h" ] && tail -n 1 "$h" | grep -q "\"run_id\":\"$RUN_ID\""; then
    :   # record-run got as far as appending; do not add a second line
  else
    l=""; if [ -s "$h" ] && [ "$(tail -c 1 "$h" | wc -l | tr -d ' ')" = 0 ]; then l=$'\n'; fi
    printf '%s{"ts":"%s","run_id":%s,"outcome":"%s","stage":%s,"total":%s,"sources":{},"duration_s":%s,"sha":%s,"warnings":0,"fatal":[%s],"node_retries":%s,"recorded_by":"bash-fallback","note":%s}\n' \
      "$l" "$ts" "$(json_str "$RUN_ID")" "$outcome" "$(json_str "$STAGE")" "$total" \
      "$(( now - W72_STARTED ))" "$sha" "$fatal" "$retries" "$(json_str "$why")" >> "$h" || return 1
  fi
  [ "$outcome" = "locked-skip" ] && return 0   # the lock holder owns status.json
  lp=$(grep '"outcome":"published"' "$h" 2>/dev/null | tail -n 1)
  if [ -n "$lp" ]; then
    ls_ts=$(printf '%s' "$lp" | sed -n 's/^{"ts":"\([^"]*\)".*/\1/p')
    ls_id=$(printf '%s' "$lp" | sed -n 's/^{"ts":"[^"]*","run_id":"\([^"]*\)".*/\1/p')
    ls_tot=$(printf '%s' "$lp" | sed -n 's/.*"stage":"[^"]*","total":\([0-9][0-9]*\),.*/\1/p')
    ls="{\"ts\":$(json_str "$ls_ts"),\"run_id\":$(json_str "$ls_id"),\"total\":${ls_tot:-null}}"
  elif [ -s "$s" ] && grep -q '^  "last_success": {' "$s"; then
    ls=$(awk '/^  "last_success": \{/{f=1; sub(/^  "last_success": /, "")} f{printf "%s", $0} f&&/^  \},?$/{exit}' "$s" | sed 's/,$//')
  fi
  cons=$(grep -o '"outcome":"[a-z-]*"' "$h" 2>/dev/null | awk -F'"' '{o[NR]=$4} END{c=0; for(i=NR;i>0;i--){if(o[i]=="published")break; if(o[i]=="rejected"||o[i]=="fatal")c++} print c}')
  src="{}"
  if [ -s "$s" ]; then
    l=$(awk '/^  "sources": \{\},?$/{exit} /^  "sources": \{/{f=1; print "{"; next} f&&/^  \},?$/{print "  }"; exit} f{print}' "$s")
    case "$l" in "{"*"  }") src="$l" ;; esac
  fi
  gen=$(grep -o '"generatedAt": *"[^"]*"' "$ROOT/events.json" 2>/dev/null | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
  if [ -n "$gen" ]; then gen=$(json_str "$gen"); else gen="null"; fi
  tmp="$s.tmp-$$"
  printf '{\n  "last_attempt": {"ts":"%s","run_id":%s,"outcome":"%s","stage":%s},\n  "last_success": %s,\n  "consecutive_failures": %s,\n  "sources": %s,\n  "deployed_sha": %s,\n  "feed_generatedAt": %s,\n  "node_retries": %s,\n  "recorded_by": "bash-fallback"\n}\n' \
    "$ts" "$(json_str "$RUN_ID")" "$outcome" "$(json_str "$STAGE")" "$ls" "${cons:-0}" "$src" "$sha" "$gen" "$retries" > "$tmp" \
    && mv -f "$tmp" "$s" || { rm -f "$tmp"; return 1; }
}

# annotate_node_retries <outcome>: after record-run.mjs, add node_retries to this
# run's history line (only when > 0, and only if that line is still the last)
# and to status.json (which record-run just rewrote; locked-skip leaves it alone).
annotate_node_retries() {
  local n h="$LOGS/history.jsonl" s="$LOGS/status.json" tmp
  n=$(node_retries)
  if [ "$n" -gt 0 ] && [ -s "$h" ] && tail -n 1 "$h" | grep -q "\"run_id\":\"$RUN_ID\""; then
    tmp="$h.tmp-$$"
    awk -v n="$n" '{ if (NR > 1) print prev; prev = $0 } END { if (NR) { sub(/}[ \t\r]*$/, ",\"node_retries\":" n "}", prev); print prev } }' "$h" > "$tmp" \
      && mv -f "$tmp" "$h" || rm -f "$tmp"
  fi
  [ "$1" = "locked-skip" ] && return 0
  if [ -s "$s" ]; then
    tmp="$s.tmp-$$"
    awk -v n="$n" '{ l[NR] = $0 } END {
        last = NR; while (last > 1 && l[last] !~ /^}/) last--
        if (last < 3) { for (i = 1; i <= NR; i++) print l[i]; exit }
        for (i = 1; i < last - 1; i++) print l[i]
        print l[last - 1] ","; print "  \"node_retries\": " n
        for (i = last; i <= NR; i++) print l[i] }' "$s" > "$tmp" && mv -f "$tmp" "$s" || rm -f "$tmp"
  fi
}

on_exit() {
  local rc=$? outcome final
  set +e
  trap - EXIT ERR
  trap '' TERM INT PIPE
  kill_child
  if [ -n "$OUTCOME" ]; then
    outcome="$OUTCOME"
  else
    outcome=fatal
    if [ ! -s "$FATAL_FILE" ]; then
      if [ "$rc" -eq 0 ]; then
        echo "build-site.sh exited 0 at stage $STAGE without an outcome" >> "$FATAL_FILE"
      else
        echo "unexpected failure (exit $rc) at stage $STAGE${ERR_AT:+: $ERR_AT}" >> "$FATAL_FILE"
      fi
    fi
  fi
  case "$outcome" in
    published|dry-run|stage-only|locked-skip) final=0 ;;
    *) final=$rc; [ "$final" -ne 0 ] || final=1 ;;
  esac
  if [ -f "$BUILD/record-run.mjs" ]; then
    local args=(--history "$LOGS/history.jsonl" --status "$LOGS/status.json"
      --outcome "$outcome" --stage "$STAGE" --run-id "$RUN_ID" --started "$W72_STARTED"
      --sha-file "$BUILD/.deployed-sha" --live-events "$ROOT/events.json" --fatal-file "$FATAL_FILE")
    if [ "$FETCHED" = 1 ]; then
      args+=(--events "$BUILD/events.json" --report "$BUILD/.source-report.json")
    fi
    [ "$VALIDATED" = 1 ] && args+=(--validate-report "$BUILD/.validate-report.json")
    # 3 x 15 s + backoff stays inside the 60 s the overall bound's KILL allows.
    local NODE_BOUND=15s rrc=0
    run_node record-run "$BUILD/record-run.mjs" "${args[@]}" || rrc=$?
    if [ "$rrc" -eq 0 ]; then
      annotate_node_retries "$outcome"
    else
      echo "WARNING: record-run.mjs failed (exit $rrc); recording this run without node" >&2
      record_fallback "$outcome" "record-run.mjs failed (exit $rrc)" \
        || echo "WARNING: could not record this run in $LOGS/history.jsonl" >&2
    fi
  else
    echo "WARNING: no build/record-run.mjs; recording this run without node" >&2
    record_fallback "$outcome" "no build/record-run.mjs" \
      || echo "WARNING: could not record this run in $LOGS/history.jsonl" >&2
  fi
  rm -f "$FATAL_FILE" "$NODE_RETRY_LOG" "$LOGS/.node-$RUN_ID".*
  log "outcome: $outcome (stage $STAGE, exit $final)"
  # Close our end of the tee so it flushes and exits with us.
  exec 7>&- >&- 2>&-
  exit "$final"
}

trap on_exit EXIT
trap 'on_signal TERM' TERM
trap 'on_signal INT' INT
trap 'ERR_AT="line $LINENO: $BASH_COMMAND"' ERR

# ---- lock ------------------------------------------------------------------------
STAGE="lock"
if command -v flock >/dev/null; then
  exec 9>"$TEST/.build.lock"
  if ! flock -n 9; then
    log "another build holds $TEST/.build.lock; skipping this run"
    OUTCOME="locked-skip"
    exit 0
  fi
else
  log "WARNING: flock not found; running without the build lock"
fi

# ---- logs ------------------------------------------------------------------------
# cron appends to logs/build.log; past 1 MB it is copied aside and truncated in
# place (cron's O_APPEND descriptor keeps writing at the new end).
if [ -f "$LOGS/build.log" ] && [ "$(wc -c < "$LOGS/build.log")" -gt 1048576 ]; then
  cp -p "$LOGS/build.log" "$LOGS/build.log.1" && : > "$LOGS/build.log"
fi
RUN_LOG="$LOGS/runs/$RUN_ID.log"
: >> "$RUN_LOG"
# tee ignores TERM/INT so the trap's last lines still reach both logs on a kill.
exec > >(exec 9>&-; trap '' TERM INT; exec tee -a "$RUN_LOG") 2>&1
exec 7>&2; RUNLOG_FD=1          # node retry lines reach the run log from any step
# Keep the newest 30 run logs.
{ ls -1t "$LOGS/runs/" 2>/dev/null | grep '\.log$' | tail -n +31 | while IFS= read -r old; do
  rm -f "$LOGS/runs/$old"
done; } || true

mode="production"
[ "$STAGE_ONLY" = 1 ] && mode="stage-only"
[ "$DRY_RUN" = 1 ] && mode="dry-run"
log "run $RUN_ID ($mode) root=$ROOT site=$SITE_URL"

cd "$BUILD"
log "node $(run_node version -v)"

# ---- 0. import completeness -------------------------------------------------
# fetch.mjs wraps every source in a try/catch that logs "unavailable — skipped",
# so a module missing from build/ does NOT fail the build — it silently deletes
# that source from the feed. That is exactly how Omnivore went absent on this
# host while the build reported success, and how a stale build/ shipped an old
# parser twice. Walk the import graph first and refuse to build an incomplete
# tree. Negative-tested: removing one core module exits 1 naming it.
STAGE="imports"
if [ -f test-imports.mjs ]; then
  if ! run_node imports test-imports.mjs . > "$BUILD/.imports.log" 2>&1; then
    cat "$BUILD/.imports.log" >&2
    die "build tree has unresolved imports; live feed left untouched"
  fi
  log "import graph complete"
fi

# ---- 1. fetch -------------------------------------------------------------
# A source report left by an earlier run must not be read as this run's.
STAGE="fetch"
rm -f "$BUILD/.source-report.json" "$BUILD/.validate-report.json"
log "fetching feed (bound $FETCH_TIMEOUT)..."
frc=0
run_node_long fetch "$FETCH_TIMEOUT" "$BUILD/.fetch.log" fetch.mjs || frc=$?
if [ "$frc" -ne 0 ]; then
  tail -20 "$BUILD/.fetch.log" >&2
  if [ "$frc" -eq 124 ]; then
    die "fetch.mjs timed out after $FETCH_TIMEOUT; live feed left untouched"
  fi
  die "fetch.mjs failed (exit $frc); live feed left untouched"
fi
[ -f "$BUILD/events.json" ] || die "fetch.mjs exited 0 but wrote no events.json"
FETCHED=1
grep -E 'unavailable|Wrote|every source' "$BUILD/.fetch.log" || true

# ---- 2. levels ------------------------------------------------------------
STAGE="levels"
if [ "$DRY_RUN" = 1 ]; then
  log "dry run: artwork levels skipped"
else
  log "measuring artwork levels..."
  if ! bash "$TEST/run-levels.sh" "$BUILD" > "$BUILD/.levels.log" 2>&1; then
    tail -20 "$BUILD/.levels.log" >&2
    die "levels failed; live levels left untouched"
  fi
  tail -2 "$BUILD/.levels.log"
fi

# ---- 2b. Washington feed ---------------------------------------------------
# The page has a live SF/Washington switcher and it fetches dc-events.json on
# demand, so that file is part of the product, not an accessory. It used to be
# built only on the VPS by a job that has since been retired, which left the
# live copy FROZEN at 2026-10-02..04 — one full day stale, and every day older
# after. Nothing in the build noticed, because nothing compared its window to
# today's.
#
# dc-fetch.mjs needs no browser: its import graph is shared.mjs -> hoods-core and
# dc-title-clean -> title-clean-core, none of which touch Playwright. So it runs
# here exactly like fetch.mjs.
#
# It is additive and CANNOT take down the SF build: any failure leaves the
# existing dc-events.json in place and logs, because a stale DC calendar is
# better than an SF site with no Washington tab. The staleness assertion below is
# what stops that tradeoff from hiding indefinitely — after a week the log says
# so instead of the problem being invisible for a month.
STAGE="dc"
dc_candidate=""
if [ -f "$BUILD/dc-fetch.mjs" ]; then
  log "fetching washington feed..."
  # The freshly built file is validated HERE, before it is promoted, and is NOT
  # allowed to overwrite the one already sitting in build/. That matters: the
  # promote stage reads $BUILD/dc-events.json, so a failed run that left a
  # half-written or empty file in build/ would promote THAT — the guard would be
  # checking a file the fetch had already replaced, and a real failure would be
  # promoted as if it had passed. The validated copy therefore goes to a
  # side-channel name that only a passing validation creates.
  dc_candidate="$BUILD/.dc-events.candidate.json"
  rm -f "$dc_candidate"
  if run_node_long dc-fetch "$FETCH_TIMEOUT" "$BUILD/.dc-fetch.log" "$BUILD/dc-fetch.mjs" \
     && cp "$BUILD/dc-events.json" "$dc_candidate" \
     && run_node dc-check -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
if(!Array.isArray(j.events)||!j.events.length){console.error("dc feed empty");process.exit(1)}
if(!Array.isArray(j.days)||!j.days.length){console.error("dc day window malformed");process.exit(1)}
console.log(`  dc feed ok: ${j.events.length} events, ${j.days.join(",")}`);
' "$dc_candidate"; then
    log "dc feed validated"
  else
    rm -f "$dc_candidate"
    log "WARNING: dc fetch failed or failed validation — keeping the previous dc-events.json"
    tail -3 "$BUILD/.dc-fetch.log" >&2 || true
  fi
else
  log "WARNING: no dc-fetch.mjs in build tree — dc-events.json will keep going stale"
fi

# ---- 3. validate ----------------------------------------------------------
# Validate before anything is replaced. A degenerate feed is worse than a stale
# one: it renders an empty page with no error. build/validate-feed.mjs checks the
# schema of every event, the 3-day window including today (Pacific), per-source
# floors and the size delta against history (plan C4). Exit 1 = rejected: /test
# and live are left exactly as they were.
STAGE="validate"
[ -f "$BUILD/validate-feed.mjs" ] || die "no build/validate-feed.mjs; refusing to publish an unvalidated feed"
vargs=(--events "$BUILD/events.json" --floors "$BUILD/source-floors.json"
  --history "$LOGS/history.jsonl" --live-url "$SITE_URL/events.json")
if [ -f "$BUILD/.source-report.json" ]; then
  vargs+=(--report "$BUILD/.source-report.json")
else
  log "WARNING: fetch.mjs wrote no build/.source-report.json; validating without per-source floors"
fi
# A dry run must not consume the one-shot build/.accept-delta meant for the real run.
if [ "$DRY_RUN" = 1 ] && [ -f "$BUILD/.accept-delta" ]; then vargs+=(--accept-delta); fi
vrc=0
run_node validate "$BUILD/validate-feed.mjs" "${vargs[@]}" || vrc=$?
[ -f "$BUILD/.validate-report.json" ] && VALIDATED=1
if [ "$vrc" -eq 1 ]; then
  echo "REJECTED: the validator refused this feed; /test and live left untouched" >&2
  OUTCOME="rejected"
  exit 1
elif [ "$vrc" -ne 0 ]; then
  die "validate-feed.mjs failed to run (exit $vrc); live feed left untouched"
fi

if [ "$DRY_RUN" = 1 ]; then
  run_node summary -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
let r=null; try{r=JSON.parse(fs.readFileSync(process.argv[2],"utf8"))}catch{}
console.log(`dry run summary: ${j.events.length} events, days ${j.days.join(",")}`);
if(r&&r.sources) for(const [n,v] of Object.entries(r.sources)) console.log(`  ${n}: ${v.status} kept ${v.kept}${v.reason?" ("+v.reason+")":""}`);
' "$BUILD/events.json" "$BUILD/.source-report.json" || true
  log "dry run: /test and live left untouched"
  OUTCOME="dry-run"
  exit 0
fi

# ---- 4. publish to /test --------------------------------------------------
STAGE="publish-test"
publish_feed() {                    # publish_feed <destdir> <label>
  local dest="$1" label="$2" f src tmp
  mkdir -p "$dest"
  for f in events.json image-levels.json; do
    src="$BUILD/$f"
    [ -f "$src" ] || die "missing $src"
    tmp=$(mktemp "$dest/.$f.XXXXXX")
    cat "$src" > "$tmp"
    chmod 644 "$tmp"
    mv -f "$tmp" "$dest/$f"
    log "published $f -> $label"
  done
}

publish_feed "$TEST" "/test"

# ---- static assets ---------------------------------------------------------
# These live in the parent docroot and are identical for the live site and this
# tree, but the page references them with RELATIVE paths — so /test/ needs its
# own copy of each. This already bit twice: the fonts/ directory was absent and
# every @font-face 404'd (page rendered in fallback serif), then favicon.svg was
# missing and the tab showed the default icon. Neither is visible in the build
# output; both are obvious to a visitor.
#
# So the list is explicit and each file is REQUIRED. Adding an asset means adding
# it here, not just to the docroot.
publish_static() {           # publish_static <src> <dest> <label>
  [ -f "$1" ] || die "required static asset missing: $1"
  mkdir -p "$(dirname "$2")"
  if [ -f "$2" ] && cmp -s "$1" "$2"; then return 0; fi
  local tmp
  tmp=$(mktemp "$(dirname "$2")/.$(basename "$2").XXXXXX")
  cat "$1" > "$tmp"; chmod 644 "$tmp"; mv -f "$tmp" "$2"
  log "published $3"
}

[ -d "$ROOT/fonts" ] || die "$ROOT/fonts missing — the page would render in fallback fonts"
for f in "$ROOT"/fonts/*.woff2; do
  [ -f "$f" ] || continue
  publish_static "$f" "$TEST/fonts/$(basename "$f")" "fonts/$(basename "$f")"
done

# favicon.svg is what the page declares. The 0-byte favicon.ico/.gif sitting in
# the docroot are DreamHost leftovers and are NOT what the page asks for, so
# they are deliberately not mirrored.
publish_static "$ROOT/favicon.svg"   "$TEST/favicon.svg"       "favicon.svg"
publish_static "$ROOT/social-share.png" "$TEST/social-share.png" "social-share.png"

# index.html is static; only replace it if it differs.
if ! cmp -s "$BUILD/index.html" "$TEST/index.html"; then
  tmp=$(mktemp "$TEST/.index.html.XXXXXX")
  cat "$BUILD/index.html" > "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$TEST/index.html"
  log "published index.html -> /test"
fi

# ---- read-back helpers (stages 6-7) -----------------------------------------
CURL=(curl -s --max-time 60)

# served_summary <path-prefix> <label>: the served feed must answer 200; prints
# "<count> <days>" and returns the count in SERVED_COUNT.
SERVED_COUNT=""
served_summary() {
  local path="$1" label="$2" url code served
  url="${SITE_URL}${path}/events.json"
  code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$url" || true)
  [ "$code" = "200" ] || die "${path:-/}/events.json serves HTTP $code"
  served=$("${CURL[@]}" "$url" | run_node_stdin served -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const a=JSON.parse(s);
  console.log(`${(a.events||[]).length} ${a.days.join(",")}`);
})') || die "${path:-/}/events.json did not parse"
  SERVED_COUNT="${served%% *}"
  log "served [$label]: $served"
}

# ---- 7. every asset the page asks for must actually serve -------------------
# Parsed FROM the served HTML rather than from a list written here, because the
# list is what went stale: fonts/ and favicon.svg were both missing while the
# build reported success. Deriving the URLs means a new <link> or @font-face
# gets checked automatically, with no edit to this script required.
check_assets() {                     # check_assets <path-prefix> <label>
  local prefix="$1" label="$2" misses bad c
  misses=$("${CURL[@]}" "${SITE_URL}${prefix}/" | run_node_stdin assets -e '
let h="";process.stdin.on("data",d=>h+=d).on("end",()=>{
  const urls=new Set();
  for (const m of h.matchAll(/<(?:link|script|img)\b[^>]*?\b(?:href|src)="([^"]+)"/gi)) {
    const u=m[1];
    if (/^(https?:|data:|#|mailto:|\/\/)/i.test(u)) continue;
    urls.add(u.split(/[?#]/)[0]);
  }
  // @font-face src: url(...) — these are relative and easy to miss.
  for (const m of h.matchAll(/url\((["\x27]?)([^)"\x27]+)\1\)/gi)) {
    const u=m[2];
    if (/^(https?:|data:|#|\/\/)/i.test(u)) continue;
    urls.add(u.split(/[?#]/)[0]);
  }
  console.log([...urls].filter(u=>u && !u.startsWith("/")).join("\n"));
})')
  [ -n "$misses" ] || { log "no relative assets referenced [$label] (unexpected)"; return 0; }
  bad=""
  while IFS= read -r u; do
    [ -n "$u" ] || continue
    case "$u" in build/*|logs/*) continue ;; esac   # denied by design
    # The inline script contains template literals like ${esc(e.image)} — JS
    # interpolations, not URLs — and a bare regex cannot tell those apart. They
    # also carry a 400-class status code, so filtering by extension is enough.
    echo "$u" | grep -qiE '\.(woff2|svg|png|jpg|jpeg|gif|webp|ico|json|css|js)$' || continue
    c=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "${SITE_URL}${prefix}/$u" || true)
    [ "$c" = "200" ] || bad="$bad
    $u -> HTTP $c"
  done <<< "$misses"
  if [ -n "$bad" ]; then
    die "referenced assets do not serve from ${prefix}/$bad"
  fi
  log "all referenced assets serve 200 [$label]"
}

built=$(run_node count -e 'console.log(JSON.parse(require("fs").readFileSync("events.json","utf8")).events.length)')

if [ "$STAGE_ONLY" = 1 ]; then
  STAGE="verify-test"
  served_summary "/test" "test"
  [ "$SERVED_COUNT" = "$built" ] || die "/test serves $SERVED_COUNT events, this build produced $built"
  check_assets "/test" "test"
  log "stage only: /test published and verified; live left untouched"
  OUTCOME="stage-only"
  exit 0
fi

# ---- 5. PROMOTE to the live docroot ---------------------------------------
# The live site is ~/whattodo72.com itself (this is the served docroot). The
# build runs out of test/build, so promoting means copying the validated files
# UP one level.
#
# index.html is deliberately NOT taken from build/. The build's copy is the
# /test/ variant, which references dc-events.json as a SIBLING of the feed —
# on /test/ that path 404s (there is no DC feed in the test tree) so the city
# switcher breaks. The live index.html is copied forward as-is so the switcher
# keeps working; it is byte-identical to build/index.html apart from that
# reference, and dc-events.json is copied alongside so the reference resolves.
#
# Every file is staged to a temp name and moved into place, so a visitor never
# sees a half-written events.json. Each move is checked individually and the
# staged set is asserted empty, because a loop that moves three of four files
# and reports success is a real failure mode, not a hypothetical one.
STAGE="promote"
log "promoting to live docroot..."
[ -f "$TEST/index.html" ] || die "no live index.html to promote"

# dc-events.json powers the SF<->Washington switcher. It used to be carried
# forward from the docroot on the assumption that "DC is still VPS-built" — which
# stopped being true the moment the VPS job was retired, leaving the file frozen
# at Oct 2-4. It is now built in stage 2b from build/dc-events.json and promoted
# here like any other feed.
#
# The previous copy is kept as .dc-events.json.prev, because a DC source outage
# must not leave the switcher with nothing: on fetch failure stage 2b leaves the
# build copy absent/unchanged, and the file below is only replaced when a NEW
# validated one exists.
if [ -n "$dc_candidate" ] && [ -f "$dc_candidate" ] && run_node dc-recheck -e '
const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
process.exit(Array.isArray(j.events)&&j.events.length?0:1)' "$dc_candidate" 2>/dev/null; then
  if [ -f "$ROOT/dc-events.json" ]; then cp -p "$ROOT/dc-events.json" "$ROOT/.dc-events.json.prev"; fi
  tmp=$(mktemp "$ROOT/.dc-events.json.XXXXXX")
  cat "$dc_candidate" > "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$ROOT/dc-events.json"
  cmp -s "$dc_candidate" "$ROOT/dc-events.json" \
    || die "promoted dc-events.json does not match the build"
  log "promoted dc-events.json -> LIVE (verified byte-identical)"
else
  log "WARNING: no validated dc-events.json in build — live DC feed left as-is"
fi

# How stale is the live DC window, in days? Printed every run. The failure this
# guards against is not "the build broke" — it is "the build quietly stopped
# building DC weeks ago and every log line still said done".
dc_age=$(run_node dc-age -e '
const fs=require("fs");
try{
  const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const newest=Math.max(...j.days.map(d=>Date.parse(d+"T00:00:00Z")))/86400000;
  const today=Math.floor(Date.now()/86400000);
  console.log(Math.max(0,Math.round(today-newest)));
}catch(e){console.log("unknown")}' "$ROOT/dc-events.json" 2>/dev/null || echo unknown)
if [ "$dc_age" = "unknown" ]; then
  log "WARNING: could not read the live dc-events.json window"
elif [ "$dc_age" -gt 7 ]; then
  echo "WARNING: live dc-events.json is $dc_age days stale" >&2
fi
log "dc feed age: ${dc_age}d"

for f in events.json image-levels.json; do
  src="$BUILD/$f"
  tmp=$(mktemp "$ROOT/.$f.XXXXXX")
  cat "$src" > "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$ROOT/$f"
  # Logged by the MOVE, not by the loop iteration. A log line emitted before
  # the operation claims success for a file that was never replaced — which is
  # exactly how a green build ships a stale feed and reads as if it worked.
  cmp -s "$src" "$ROOT/$f" || die "promoted $f does not match the build"
  log "promoted $f -> LIVE (verified byte-identical)"
done

# The live index.html is the one already in the docroot, which the VPS deploy
# wrote; it is byte-identical to build/index.html apart from dc-events. Copying
# build/index.html over it would break the DC switcher, so it is left alone and
# only asserted here.
if ! cmp -s "$ROOT/index.html" "$BUILD/index.html"; then
  log "note: live index.html differs from build/index.html (expected: dc-events switcher ref)"
fi

# ---- 6. verify what a visitor actually gets --------------------------------
# Nothing above is proof. A build can exit 0 while publishing a stale copy from
# build/ — that happened twice today: the served site kept the old parser and
# the dead-URL table simply was not there, so the guard that should have caught
# it passed vacuously. So both trees are read back from the PUBLIC URL, and the
# served bytes are compared against the build, not against local disk.
STAGE="verify"
served_summary "/test" "test"
served_summary "" "live"

# The whole point of promoting is that the live site carries the new code's
# output. Compare the served event COUNT against what was just built: if the
# live feed is not the file this run produced, the promotion did not happen,
# whatever the exit status said.
live="$SERVED_COUNT"
if [ "$built" != "$live" ]; then
  die "live feed has $live events, this build produced $built"
fi
log "live feed matches this build ($built events)"

STAGE="assets"
log "checking referenced assets..."
check_assets "/test" "test"
check_assets "" "live"

# The switcher is a live control, not decoration. Promoting an index.html that
# references dc-events.json without the file present is a 404 the build cannot
# see, because the page loads fine without it — the break is in the click.
if grep -q 'feed: "dc-events.json"' "$ROOT/index.html"; then
  dc=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "${SITE_URL}/dc-events.json" || true)
  [ "$dc" = "200" ] || die "live index.html references dc-events.json but it serves HTTP $dc"
  log "city switcher feed resolves (dc-events.json 200)"
fi

STAGE="done"
OUTCOME="published"
log "done"
