#!/usr/bin/env bash
# Offline tests for build-site.sh (plan C4, C5, C6, C8). No network: every case
# runs the REAL build-site.sh, validate-feed.mjs and record-run.mjs in a temp
# ROOT with a stub fetch.mjs / dc-fetch.mjs / run-levels.sh, and a local
# python3 http.server stands in for SITE_URL. Works on bash 3.2 (macOS) and
# bash 4+ (DreamHost). Lock cases need flock(1) and the overall-bound case needs
# timeout(1): where those are absent (macOS) they print SKIP; on DreamHost they run.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SB="$(mktemp -d "${TMPDIR:-/tmp}/build-site-test.XXXXXX")"
SB="$(cd "$SB" && pwd -P)"
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then { kill "$SERVER_PID"; wait "$SERVER_PID"; } 2>/dev/null; fi
  # stray stubs from a failed case
  pkill -f "$SB/" 2>/dev/null
  rm -rf "$SB"
}
trap cleanup EXIT

PASS=0; FAIL=0; SKIP=0; CASES=0
ok()   { if [ "$2" = 0 ]; then PASS=$((PASS + 1)); echo "  ok   $1"; else FAIL=$((FAIL + 1)); echo "  FAIL $1"; [ -n "${3:-}" ] && sed 's/^/        /' "$3" | tail -25; fi; }
check() { local name="$1" out="$2"; shift 2; if "$@"; then ok "$name" 0; else ok "$name" 1 "$out"; fi; }
skip() { SKIP=$((SKIP + 1)); echo "  SKIP $1"; }
case_start() { CASES=$((CASES + 1)); echo "case $CASES: $1"; }

# json <file> <js-expression over j>: print the value
json() { node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=(new Function("j","return ("+process.argv[2]+")"))(j);console.log(typeof v==="object"?JSON.stringify(v):String(v))' "$1" "$2"; }
# last <root> <js-expression over r>: on the newest history record
last() { node -e 'const fs=require("fs");const l=fs.readFileSync(process.argv[1],"utf8").trim().split("\n");const r=JSON.parse(l[l.length-1]);const v=(new Function("r","return ("+process.argv[2]+")"))(r);console.log(typeof v==="object"?JSON.stringify(v):String(v))' "$1/test/logs/history.jsonl" "$2"; }
md5of() { if [ -f "$1" ]; then cksum < "$1"; else echo absent; fi; }

# ---- local SITE_URL ---------------------------------------------------------
python3 - "$SB" "$SB/.port" <<'PY' >/dev/null 2>&1 &
import http.server, os, socketserver, sys
os.chdir(sys.argv[1])
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
class S(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True
s = S(("127.0.0.1", 0), H)
open(sys.argv[2] + ".tmp", "w").write(str(s.server_address[1]))
os.rename(sys.argv[2] + ".tmp", sys.argv[2])
s.serve_forever()
PY
SERVER_PID=$!
for _ in $(seq 1 50); do [ -s "$SB/.port" ] && break; sleep 0.1; done
[ -s "$SB/.port" ] || { echo "FAIL could not start python3 http.server"; exit 1; }
PORT="$(cat "$SB/.port")"

# ---- sandbox ROOT -------------------------------------------------------------
STUB_FETCH="$SB/.stub-fetch.mjs"
{ awk '/^const CATEGORIES *= *\[/,/^\];/' "$REPO/build/fetch.mjs"; cat "$REPO/tests/fixtures/stub-fetch.mjs"; } > "$STUB_FETCH"
grep -q 'const CATEGORIES' "$STUB_FETCH" || { echo "FAIL cannot extract CATEGORIES from build/fetch.mjs"; exit 1; }
PREV_FEED="$SB/.prev-feed.json"
node -e 'const j=require(process.argv[1]);j.generatedAt="2026-01-01T00:00:00.000Z";require("fs").writeFileSync(process.argv[2],JSON.stringify(j))' "$REPO/tests/fixtures/feed-good.json" "$PREV_FEED"

mk_case() {                        # mk_case <name>: fresh ROOT at $SB/<name>
  local r="$SB/$1"
  mkdir -p "$r/test/build" "$r/fonts"
  cp "$REPO/build-site.sh" "$r/test/build-site.sh"
  cp "$REPO/build/validate-feed.mjs" "$REPO/build/record-run.mjs" "$REPO/build/source-floors.json" "$REPO/build/test-imports.mjs" "$r/test/build/"
  cp "$STUB_FETCH" "$r/test/build/fetch.mjs"
  cat > "$r/test/build/dc-fetch.mjs" <<'JS'
import fs from "node:fs";
fs.writeFileSync("dc-events.json", JSON.stringify({ days: ["2026-10-07"], events: [{ id: "dc1" }] }));
JS
  cat > "$r/test/run-levels.sh" <<'SH'
#!/usr/bin/env bash
printf '{"levels":{}}\n' > "$1/image-levels.json"
echo "levels: measured 0 images"
echo "levels: done"
SH
  local page='<html><head><link rel="icon" href="favicon.svg"><style>@font-face{font-family:a;src:url(fonts/a.woff2)}</style></head><body>stub</body></html>'
  echo "$page" > "$r/test/build/index.html"
  printf '%s\n' '<html><head><link rel="icon" href="favicon.svg"></head><body><script>const C={feed: "dc-events.json"}</script></body></html>' > "$r/index.html"
  printf 'woff2' > "$r/fonts/a.woff2"
  printf '<svg xmlns="http://www.w3.org/2000/svg"/>' > "$r/favicon.svg"
  printf 'png' > "$r/social-share.png"
  cp "$PREV_FEED" "$r/events.json"
  echo "$r"
}

# run_build <name> [VAR=value...]: run synchronously; output in $SB/<name>.out
run_build() {
  local name="$1"; shift
  env ROOT="$SB/$name" SITE_URL="http://127.0.0.1:$PORT/$name" \
      STUB_FEED="$REPO/tests/fixtures/feed-good.json" "$@" \
      bash "$SB/$name/test/build-site.sh" > "$SB/$name.out" 2>&1
}
# start_build: same, in the background; sets BG_PID
start_build() {
  local name="$1"; shift
  env ROOT="$SB/$name" SITE_URL="http://127.0.0.1:$PORT/$name" \
      STUB_FEED="$REPO/tests/fixtures/feed-good.json" "$@" \
      bash "$SB/$name/test/build-site.sh" > "$SB/$name.out" 2>&1 &
  BG_PID=$!
}
wait_for() { local i; for i in $(seq 1 100); do [ -e "$1" ] && return 0; sleep 0.1; done; return 1; }

HAVE_FLOCK=0; command -v flock >/dev/null && HAVE_FLOCK=1
HAVE_TIMEOUT=0; command -v timeout >/dev/null && HAVE_TIMEOUT=1
T0=$(date +%s)
echo "node $(node -v), bash $BASH_VERSION, flock=$HAVE_FLOCK timeout=$HAVE_TIMEOUT, sandbox $SB"

# ---- 1. good run ---------------------------------------------------------------
case_start "good run publishes /test and live"
R=$(mk_case good); run_build good; rc=$?; O="$SB/good.out"
check "exit 0" "$O" [ "$rc" = 0 ]
check "/test and live events.json byte-identical to the build" "$O" sh -c "cmp -s '$R/test/build/events.json' '$R/test/events.json' && cmp -s '$R/test/build/events.json' '$R/events.json'"
check "image-levels.json and dc-events.json promoted" "$O" sh -c "cmp -s '$R/test/build/image-levels.json' '$R/image-levels.json' && cmp -s '$R/test/build/dc-events.json' '$R/dc-events.json'"
check "history: published, total 60, dothebay 60, duration, stage done" "$O" [ "$(last "$R" 'r.outcome+" "+r.total+" "+r.sources.dothebay+" "+r.stage+" "+(r.duration_s>=0)')" = "published 60 60 done true" ]
rid="$(last "$R" r.run_id)"
check "status.json: last_attempt/last_success = this run, 0 failures, zero_streak 0" "$O" [ "$(json "$R/test/logs/status.json" 'j.last_attempt.run_id+" "+j.last_attempt.outcome+" "+j.last_success.run_id+" "+j.last_success.total+" "+j.consecutive_failures+" "+j.sources.dothebay.zero_streak+" "+j.sources.dothebay.kept')" = "$rid published $rid 60 0 0 60" ]
check "status.json feed_generatedAt = the published feed" "$O" [ "$(json "$R/test/logs/status.json" j.feed_generatedAt)" = "$(json "$R/events.json" j.generatedAt)" ]
check "run log written to logs/runs/<run_id>.log" "$O" grep -q "promoted events.json -> LIVE" "$R/test/logs/runs/$rid.log"
check "read-back from SITE_URL ran" "$O" grep -q "live feed matches this build (60 events)" "$O"

# ---- 2. bad feed -> rejected -----------------------------------------------------
case_start "bad feed (string categories) is rejected"
R=$(mk_case bad); before=$(md5of "$R/events.json"); run_build bad STUB_MODE=bad; rc=$?; O="$SB/bad.out"
check "exit non-zero" "$O" [ "$rc" != 0 ]
check "history outcome rejected at stage validate, fatal names categories" "$O" [ "$(last "$R" 'r.outcome+" "+r.stage+" "+r.fatal.some(f=>f.includes("categories"))')" = "rejected validate true" ]
check "live events.json unchanged, /test never written" "$O" [ "$(md5of "$R/events.json")" = "$before" -a "$(md5of "$R/test/events.json")" = absent ]
check "status.json: rejected, 1 consecutive failure, no last_success" "$O" [ "$(json "$R/test/logs/status.json" 'j.last_attempt.outcome+" "+j.consecutive_failures+" "+j.last_success')" = "rejected 1 null" ]

# ---- 3. fetch exit 1 -> fatal ------------------------------------------------------
case_start "fetch.mjs exit 1 is fatal"
R=$(mk_case failfetch); before=$(md5of "$R/events.json"); run_build failfetch STUB_MODE=fail; rc=$?; O="$SB/failfetch.out"
check "exit non-zero" "$O" [ "$rc" != 0 ]
check "history fatal at stage fetch with the message, total null" "$O" [ "$(last "$R" 'r.outcome+" "+r.stage+" "+r.fatal.some(f=>f.includes("fetch.mjs failed"))+" "+r.total')" = "fatal fetch true null" ]
check "live unchanged, /test never written" "$O" [ "$(md5of "$R/events.json")" = "$before" -a "$(md5of "$R/test/events.json")" = absent ]

# ---- 4. lock -------------------------------------------------------------------
case_start "second instance while the first runs -> locked-skip"
if [ "$HAVE_FLOCK" = 1 ]; then
  R=$(mk_case lock)
  start_build lock STUB_SLEEP=4; A=$BG_PID
  wait_for "$R/test/build/.stub-started"
  env ROOT="$R" SITE_URL="http://127.0.0.1:$PORT/lock" bash "$R/test/build-site.sh" > "$SB/lock2.out" 2>&1; rc2=$?
  check "second instance exits 0" "$SB/lock2.out" [ "$rc2" = 0 ]
  check "second instance recorded locked-skip" "$SB/lock2.out" grep -q '"outcome":"locked-skip"' "$R/test/logs/history.jsonl"
  wait "$A"; rc=$?
  check "first instance still publishes" "$SB/lock.out" [ "$rc" = 0 -a "$(last "$R" r.outcome)" = published ]
  check "status.json belongs to the lock holder" "$SB/lock.out" [ "$(json "$R/test/logs/status.json" j.last_attempt.outcome)" = published ]
else
  skip "flock(1) not available on this host (runs on DreamHost)"
fi

# ---- 5. DRY_RUN ---------------------------------------------------------------
case_start "DRY_RUN writes neither /test nor live"
R=$(mk_case dry); before=$(md5of "$R/events.json"); run_build dry DRY_RUN=1; rc=$?; O="$SB/dry.out"
check "exit 0, history dry-run at stage validate" "$O" [ "$rc" = 0 -a "$(last "$R" 'r.outcome+" "+r.stage+" "+r.total')" = "dry-run validate 60" ]
check "live unchanged, /test not written" "$O" [ "$(md5of "$R/events.json")" = "$before" -a "$(md5of "$R/test/events.json")" = absent -a ! -e "$R/test/favicon.svg" ]
check "levels skipped, validate report written, summary printed" "$O" sh -c "[ ! -e '$R/test/build/image-levels.json' ] && [ -f '$R/test/build/.validate-report.json' ] && grep -q 'dry run summary: 60 events' '$O'"

# ---- 6. STAGE_ONLY -------------------------------------------------------------
case_start "STAGE_ONLY writes /test only"
R=$(mk_case stage); before=$(md5of "$R/events.json"); run_build stage STAGE_ONLY=1; rc=$?; O="$SB/stage.out"
check "exit 0, history stage-only" "$O" [ "$rc" = 0 -a "$(last "$R" r.outcome)" = stage-only ]
check "/test published (feed + static assets)" "$O" sh -c "cmp -s '$R/test/build/events.json' '$R/test/events.json' && [ -f '$R/test/favicon.svg' ] && [ -f '$R/test/fonts/a.woff2' ]"
check "live events.json unchanged, no dc promote" "$O" [ "$(md5of "$R/events.json")" = "$before" -a ! -e "$R/dc-events.json" ]

# ---- 7. hung fetch --------------------------------------------------------------
case_start "hung fetch is killed by FETCH_TIMEOUT=2s"
R=$(mk_case hang); before=$(md5of "$R/events.json"); s=$(date +%s)
run_build hang STUB_MODE=hang FETCH_TIMEOUT=2s; rc=$?; O="$SB/hang.out"; took=$(( $(date +%s) - s ))
check "exit non-zero within 20 s (took ${took}s)" "$O" [ "$rc" != 0 -a "$took" -lt 20 ]
check "history fatal at fetch, message says timed out" "$O" [ "$(last "$R" 'r.outcome+" "+r.stage+" "+r.fatal.some(f=>f.includes("timed out after 2s"))')" = "fatal fetch true" ]
check "live unchanged" "$O" [ "$(md5of "$R/events.json")" = "$before" ]
sleep 0.5
check "the hung stub fetch process is gone" "$O" sh -c "! kill -0 \$(cat '$R/test/build/.stub-started') 2>/dev/null"

# ---- 8. history trim ------------------------------------------------------------
case_start "history trims to 500 lines"
R=$(mk_case trim); mkdir -p "$R/test/logs"
node -e 'const l=[];for(let i=0;i<600;i++)l.push(JSON.stringify({ts:"2026-10-01T00:00:00Z",run_id:"old"+i,outcome:"published",stage:"done",total:60,sources:{dothebay:60},duration_s:1,sha:null,warnings:0,fatal:[]}));require("fs").writeFileSync(process.argv[1],l.join("\n")+"\n")' "$R/test/logs/history.jsonl"
run_build trim; rc=$?; O="$SB/trim.out"
check "exit 0, exactly 500 lines, newest is this run, oldest is old101" "$O" [ "$rc" = 0 -a "$(wc -l < "$R/test/logs/history.jsonl" | tr -d ' ')" = 500 -a "$(last "$R" r.outcome)" = published -a "$(head -1 "$R/test/logs/history.jsonl" | grep -c '"old101"')" = 1 ]

# ---- 9. run log retention -------------------------------------------------------
case_start "run logs: keep the newest 30"
R=$(mk_case keep); mkdir -p "$R/test/logs/runs"
for i in $(seq 10 44); do echo old > "$R/test/logs/runs/20200101T0000${i}Z-1.log"; touch -t "2020010100$i" "$R/test/logs/runs/20200101T0000${i}Z-1.log"; done
run_build keep RUN_ID=keep-run; rc=$?; O="$SB/keep.out"
check "exit 0, 30 run logs, this run's kept, oldest gone" "$O" [ "$rc" = 0 -a "$(ls "$R/test/logs/runs" | grep -c '\.log$')" = 30 -a -f "$R/test/logs/runs/keep-run.log" -a ! -f "$R/test/logs/runs/20200101T000010Z-1.log" ]

# ---- 10. replace build-site.sh by mv mid-run -------------------------------------
case_start "mv over build-site.sh mid-run does not corrupt the running instance"
R=$(mk_case mv)
start_build mv STUB_SLEEP=3; A=$BG_PID
wait_for "$R/test/build/.stub-started"
printf '#!/usr/bin/env bash\necho REPLACED-SCRIPT-RAN\nexit 9\n%s\n' "$(head -c 20000 /dev/zero | tr '\0' '#')" > "$R/test/.build-site.sh.new"
mv -f "$R/test/.build-site.sh.new" "$R/test/build-site.sh"
wait "$A"; rc=$?; O="$SB/mv.out"
check "running instance finished on the old inode and published" "$O" [ "$rc" = 0 -a "$(last "$R" r.outcome)" = published ]
check "no line of the replacement ran" "$O" sh -c "! grep -q REPLACED-SCRIPT-RAN '$O'"

# ---- 11. old fetch.mjs without a source report ---------------------------------------
case_start "no .source-report.json: validate without it and warn"
R=$(mk_case noreport); run_build noreport STUB_MODE=noreport; rc=$?; O="$SB/noreport.out"
check "exit 0, published with empty sources" "$O" [ "$rc" = 0 -a "$(last "$R" 'r.outcome+" "+JSON.stringify(r.sources)')" = "published {}" ]
check "warning printed" "$O" grep -q "wrote no build/.source-report.json" "$O"

# ---- 12. SIGTERM mid-run (what the overall timeout sends) ----------------------------
case_start "SIGTERM mid-fetch is recorded as fatal"
R=$(mk_case term); before=$(md5of "$R/events.json")
start_build term STUB_SLEEP=30; A=$BG_PID
wait_for "$R/test/build/.stub-started"; sleep 0.3
s=$(date +%s); kill -TERM "$A"; wait "$A"; rc=$?; took=$(( $(date +%s) - s )); O="$SB/term.out"
check "exit non-zero within 10 s (took ${took}s)" "$O" [ "$rc" != 0 -a "$took" -lt 10 ]
check "history fatal at fetch, killed by SIGTERM" "$O" [ "$(last "$R" 'r.outcome+" "+r.stage+" "+r.fatal.some(f=>f.includes("SIGTERM"))')" = "fatal fetch true" ]
check "live unchanged" "$O" [ "$(md5of "$R/events.json")" = "$before" ]

# ---- 13. BUILD_TIMEOUT -----------------------------------------------------------
case_start "BUILD_TIMEOUT bounds the whole run"
if [ "$HAVE_TIMEOUT" = 1 ]; then
  R=$(mk_case overall); s=$(date +%s)
  run_build overall STUB_SLEEP=60 BUILD_TIMEOUT=3s FETCH_TIMEOUT=60s; rc=$?; took=$(( $(date +%s) - s )); O="$SB/overall.out"
  check "exit non-zero within 15 s (took ${took}s)" "$O" [ "$rc" != 0 -a "$took" -lt 15 ]
  check "history fatal, killed by SIGTERM" "$O" [ "$(last "$R" 'r.outcome+" "+r.fatal.some(f=>f.includes("SIGTERM"))')" = "fatal true" ]
else
  skip "timeout(1) not available on this host (runs on DreamHost)"
fi

# ---- 14. build.log rotation ---------------------------------------------------------
case_start "logs/build.log rotates past 1 MB"
R=$(mk_case rotate); mkdir -p "$R/test/logs"
head -c 1100000 /dev/zero | tr '\0' 'x' > "$R/test/logs/build.log"
run_build rotate; rc=$?; O="$SB/rotate.out"
check "build.log.1 holds the old 1.1 MB, build.log truncated" "$O" [ "$rc" = 0 -a "$(wc -c < "$R/test/logs/build.log.1" | tr -d ' ')" = 1100000 -a "$(wc -c < "$R/test/logs/build.log" | tr -d ' ')" = 0 ]

# ---- node launch flakes (T14) ----------------------------------------------------
# A stub node (tests/fixtures/stub-node.sh, via W72_NODE) fails chosen launches
# the way DreamHost's node 18 does, then runs the real node.
STUB_NODE="$SB/.stub-node.sh"
cp "$REPO/tests/fixtures/stub-node.sh" "$STUB_NODE"; chmod +x "$STUB_NODE"
REAL_NODE="$(command -v node)"
# flaky <name> [VAR=value...]: run_build with the stub node; launches counted in $SB/<name>.calls
flaky() { local name="$1"; shift; run_build "$name" W72_NODE="$STUB_NODE" STUB_NODE_REAL="$REAL_NODE" STUB_NODE_STATE="$SB/$name.calls" "$@"; }
calls() { if [ -f "$SB/$1.calls" ]; then wc -l < "$SB/$1.calls" | tr -d ' '; else echo 0; fi; }

case_start "quick step: one launch flake (SIGABRT) then success -> published, node_retries 1"
R=$(mk_case flake1); s=$(date +%s)
flaky flake1 STUB_NODE_MATCH='validate-feed\.mjs' STUB_NODE_FAILS=1 STUB_NODE_MODE=abort; rc=$?; took=$(( $(date +%s) - s )); O="$SB/flake1.out"
check "exit 0, history published with node_retries 1" "$O" [ "$rc" = 0 -a "$(last "$R" 'r.outcome+" "+r.node_retries')" = "published 1" ]
check "status.json: published, node_retries 1" "$O" [ "$(json "$R/test/logs/status.json" 'j.last_attempt.outcome+" "+j.node_retries+" "+j.consecutive_failures')" = "published 1 0" ]
rid="$(last "$R" r.run_id)"
check "validator launched twice; run log has the retry line; waited >= 3 s (took ${took}s)" "$O" sh -c "[ $(calls flake1) = 2 ] && [ $took -ge 3 ] && grep -q 'retry node validate (attempt 2/3, SIGABRT, exit 134)' '$R/test/logs/runs/$rid.log'"

case_start "quick step: three launch flakes -> fatal at that stage, backoff 3 s + 8 s"
R=$(mk_case flake3); before=$(md5of "$R/events.json"); s=$(date +%s)
flaky flake3 STUB_NODE_MATCH='validate-feed\.mjs' STUB_NODE_FAILS=9 STUB_NODE_MODE=abort; rc=$?; took=$(( $(date +%s) - s )); O="$SB/flake3.out"
check "exit non-zero, history fatal at validate naming exit 134" "$O" [ "$rc" != 0 -a "$(last "$R" 'r.outcome+" "+r.stage+" "+r.fatal.some(f=>f.includes("validate-feed.mjs failed to run (exit 134)"))+" "+r.node_retries')" = "fatal validate true 2" ]
check "exactly 3 launches, >= 11 s of backoff (took ${took}s), live unchanged" "$O" [ "$(calls flake3)" = 3 -a "$took" -ge 11 -a "$(md5of "$R/events.json")" = "$before" ]
check "two retry lines, attempts 2/3 and 3/3" "$O" sh -c "grep -q 'retry node validate (attempt 2/3' '$O' && grep -q 'retry node validate (attempt 3/3' '$O'"

case_start "quick step: exit 1 + pthread_create x3 is fatal, never read as a rejection"
R=$(mk_case eagain3)
flaky eagain3 W72_NODE_BACKOFF="0 0" STUB_NODE_MATCH='validate-feed\.mjs' STUB_NODE_FAILS=9 STUB_NODE_MODE=eagain; rc=$?; O="$SB/eagain3.out"
check "exit non-zero, fatal (not rejected) at validate, exit 75, 3 launches" "$O" [ "$rc" != 0 -a "$(last "$R" 'r.outcome+" "+r.stage+" "+r.fatal.some(f=>f.includes("exit 75"))')" = "fatal validate true" -a "$(calls eagain3)" = 3 ]
check "retry reason names thread creation" "$O" grep -q 'retry node validate (attempt 2/3, could not create a thread, exit 1)' "$O"

case_start "real validator rejection is NOT retried"
R=$(mk_case noretry)
flaky noretry STUB_MODE=bad STUB_NODE_MATCH='validate-feed\.mjs' STUB_NODE_FAILS=0; rc=$?; O="$SB/noretry.out"
check "exit non-zero, outcome rejected, validator launched once" "$O" [ "$rc" != 0 -a "$(last "$R" r.outcome)" = rejected -a "$(calls noretry)" = 1 ]
check "no retry line, no node_retries in history, status node_retries 0" "$O" [ "$(grep -c 'retry node' "$O")" = 0 -a "$(last "$R" 'String(r.node_retries)')" = undefined -a "$(json "$R/test/logs/status.json" j.node_retries)" = 0 ]

case_start "quick step: a startup hang is killed by the bound and retried"
R=$(mk_case qhang); s=$(date +%s)
flaky qhang W72_NODE_QUICK_BOUND=2s W72_NODE_BACKOFF="0 0" STUB_NODE_MATCH='test-imports\.mjs' STUB_NODE_FAILS=1 STUB_NODE_MODE=hang; rc=$?; took=$(( $(date +%s) - s )); O="$SB/qhang.out"
check "exit 0, published, node_retries 1, within 30 s (took ${took}s)" "$O" [ "$rc" = 0 -a "$(last "$R" 'r.outcome+" "+r.node_retries')" = "published 1" -a "$took" -lt 30 ]
check "retry reason says hung" "$O" grep -q 'retry node imports (attempt 2/3, no exit within the bound, hung)' "$O"

case_start "dc-fetch: launch flake (SIGTRAP) within the window is retried once"
R=$(mk_case dcflake)
flaky dcflake W72_NODE_BACKOFF="0 0" STUB_NODE_MATCH='dc-fetch\.mjs' STUB_NODE_FAILS=1 STUB_NODE_MODE=trap; rc=$?; O="$SB/dcflake.out"
check "exit 0, published, dc-events.json promoted, 2 launches" "$O" [ "$rc" = 0 -a "$(last "$R" r.outcome)" = published -a -f "$R/dc-events.json" -a "$(calls dcflake)" = 2 ]
check "retry line for dc-fetch (attempt 2/2, SIGTRAP)" "$O" grep -q 'retry node dc-fetch (attempt 2/2, SIGTRAP, exit 133' "$O"

case_start "fetch: launch flake within the window is retried once"
R=$(mk_case fflake)
flaky fflake W72_NODE_BACKOFF="0 0" STUB_NODE_MATCH='^fetch\.mjs' STUB_NODE_FAILS=1 STUB_NODE_MODE=abort; rc=$?; O="$SB/fflake.out"
check "exit 0, published with node_retries 1, 2 launches" "$O" [ "$rc" = 0 -a "$(last "$R" 'r.outcome+" "+r.total+" "+r.node_retries')" = "published 60 1" -a "$(calls fflake)" = 2 ]
check "retry line and the first attempt's log kept as .fetch.log.flaked" "$O" sh -c "grep -q 'retry node fetch (attempt 2/2, SIGABRT, exit 134 after' '$O' && grep -q pthread_create '$R/test/build/.fetch.log.flaked'"
R=$(mk_case fflake2)
flaky fflake2 W72_NODE_BACKOFF="0 0" STUB_NODE_MATCH='^fetch\.mjs' STUB_NODE_FAILS=5 STUB_NODE_MODE=abort; rc=$?; O="$SB/fflake2.out"
check "two flakes in a row: fatal at fetch after exactly 2 launches (retry once only)" "$O" [ "$rc" != 0 -a "$(last "$R" 'r.outcome+" "+r.stage')" = "fatal fetch" -a "$(calls fflake2)" = 2 ]

case_start "fetch: a death after the window is NOT retried"
R=$(mk_case flate)
flaky flate W72_NODE_FLAKE_WINDOW=1 STUB_NODE_DELAY=2 STUB_NODE_MATCH='^fetch\.mjs' STUB_NODE_FAILS=1 STUB_NODE_MODE=abort; rc=$?; O="$SB/flate.out"
check "fatal at fetch (exit 134), one launch, no retry line" "$O" [ "$rc" != 0 -a "$(last "$R" 'r.outcome+" "+r.stage+" "+r.fatal.some(f=>f.includes("exit 134"))')" = "fatal fetch true" -a "$(calls flate)" = 1 -a "$(grep -c 'retry node' "$O")" = 0 ]

case_start "fetch: a normal failure (exit 1, no thread message) is NOT retried"
R=$(mk_case fnorm)
flaky fnorm STUB_MODE=fail STUB_NODE_MATCH='^fetch\.mjs' STUB_NODE_FAILS=0; rc=$?; O="$SB/fnorm.out"
check "fatal at fetch, one launch, no retry line" "$O" [ "$rc" != 0 -a "$(last "$R" 'r.outcome+" "+r.stage')" = "fatal fetch" -a "$(calls fnorm)" = 1 -a "$(grep -c 'retry node' "$O")" = 0 ]

case_start "record-run.mjs cannot start: bash fallback writes valid history + status"
R=$(mk_case rrfb); H="$R/test/logs/history.jsonl"; ST="$R/test/logs/status.json"
run_build rrfb RUN_ID=rrfb-1; rc1=$?
flaky rrfb RUN_ID=rrfb-2 STUB_MODE=fail W72_NODE_BACKOFF="0 0" STUB_NODE_MATCH='record-run\.mjs' STUB_NODE_FAILS=99 STUB_NODE_MODE=eagain; rc2=$?; O="$SB/rrfb.out"
allparse() { node -e 'const fs=require("fs");for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n"))if(l.trim())JSON.parse(l);JSON.parse(fs.readFileSync(process.argv[2],"utf8"))' "$H" "$ST"; }
check "seed run published; failed run exits non-zero" "$O" [ "$rc1" = 0 -a "$rc2" != 0 ]
check "every history line and status.json parse" "$O" allparse
check "fallback line: fatal at fetch, message kept, node_retries 2, recorded_by bash-fallback" "$O" [ "$(last "$R" 'r.run_id+" "+r.outcome+" "+r.stage+" "+r.fatal.some(f=>f.includes("fetch.mjs failed"))+" "+r.node_retries+" "+r.recorded_by+" "+r.total')" = "rrfb-2 fatal fetch true 2 bash-fallback null" ]
check "fallback status: last_attempt fatal, last_success = seed run (60), 1 failure, sources carried" "$O" [ "$(json "$ST" 'j.last_attempt.run_id+" "+j.last_attempt.outcome+" "+j.last_success.run_id+" "+j.last_success.total+" "+j.consecutive_failures+" "+j.sources.dothebay.kept+" "+j.node_retries+" "+j.recorded_by')" = "rrfb-2 fatal rrfb-1 60 1 60 2 bash-fallback" ]
check "fallback status: feed_generatedAt = the live feed; python3 parses it too" "$O" sh -c "[ \"$(json "$ST" j.feed_generatedAt)\" = \"$(json "$R/events.json" j.generatedAt)\" ] && python3 -c 'import json,sys; json.load(open(sys.argv[1]))' '$ST'"
flaky rrfb RUN_ID=rrfb-3 W72_NODE_BACKOFF="0 0" STUB_NODE_MATCH='record-run\.mjs' STUB_NODE_FAILS=99 STUB_NODE_MODE=abort; rc3=$?
check "published run via fallback: exit 0, total 60, last_success = it, 0 failures, sources still carried" "$O" [ "$rc3" = 0 -a "$(last "$R" 'r.outcome+" "+r.total')" = "published 60" -a "$(json "$ST" 'j.last_success.run_id+" "+j.last_success.total+" "+j.consecutive_failures+" "+j.sources.dothebay.kept')" = "rrfb-3 60 0 60" ]
run_build rrfb RUN_ID=rrfb-4; rc4=$?
check "record-run.mjs reads fallback-written files: next run published, 4 lines" "$O" [ "$rc4" = 0 -a "$(wc -l < "$H" | tr -d ' ')" = 4 -a "$(json "$ST" 'j.last_success.run_id+" "+j.recorded_by+" "+j.sources.dothebay.zero_streak')" = "rrfb-4 undefined 0" ]
check "all lines and status.json still parse" "$O" allparse

case_start "json_str escapes quotes, backslashes and control characters"
eval "$(sed -n '/^json_str() {/,/^}/p' "$REPO/build-site.sh")"
js="$(json_str "$(printf 'a"b\\c\td\ne\001f')")"
check "JSON.parse(json_str(x)) round-trips the printable text" "$SB/jsonstr.out" [ "$(node -e 'console.log(JSON.parse(process.argv[1]))' "$js" 2>"$SB/jsonstr.out")" = 'a"b\c def' ]

echo
echo "$CASES cases, $PASS passed, $FAIL failed, $SKIP skipped ($(( $(date +%s) - T0 ))s)"
[ "$FAIL" = 0 ]
