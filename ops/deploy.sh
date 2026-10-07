#!/usr/bin/env bash
# ops/deploy.sh: put a pushed commit live on DreamHost, reversibly (plan contract C9).
# Runs on the Mac. Every remote step goes through remote()/remote_extract() in
# ops/lib.sh: by default `ssh hermes 'ssh -o BatchMode=yes dh-backup bash -s'`.
#
#   bash ops/deploy.sh                      stage, preflight, dry run, swap
#   bash ops/deploy.sh --check              stage, preflight, dry run; never swaps
#   bash ops/deploy.sh --skip-dry-run --i-know   skip the dry run (refused without --i-know)
#   bash ops/deploy.sh --rollback           swap build with the newest build.prev-*
#   bash ops/deploy.sh --status             deployed sha vs HEAD, last 3 history lines
#   bash ops/deploy.sh --selftest           offline proof against a simulated remote
#
# Deploy steps:
#   0. refuse unless the git tree is clean and HEAD is on a remote branch
#   1. stage      git archive HEAD -> ~/whattodo72.com/test/.deploy/<sha>/
#   2. preflight  remote node: node --check every build/**/*.mjs, bash -n every *.sh,
#                 bash tests/run-all.sh
#   3. dry run    DRY_RUN=1 ROOT=<sandbox> build-site.sh on the staged tree, with a copy of
#                 the live generated state and logs/history.jsonl (real network, ~4 min)
#   4. swap       under `flock -w $DEPLOY_LOCK_WAIT test/.build.lock`: build -> build.prev-<utc>
#                 (old top-level scripts kept in build.prev-<utc>/_scripts/), staged build in,
#                 generated state carried over, top-level scripts installed by rename,
#                 build/.deployed-sha written, newest 5 build.prev-* kept, staging removed.
# A failure before step 4 leaves prod exactly as it was (staging is removed).
#
# Exit codes: 0 ok · 1 usage/transport · 2 refused (dirty, unpushed, unsafe flags,
# nothing to roll back) · 3 preflight failed · 4 dry run failed · 5 swap failed
# (automatic rollback attempted; the output says whether it completed).
#
# Env: DEPLOY_TRANSPORT=ssh|local, DEPLOY_REMOTE_HOME (local only), DEPLOY_HOP1/2,
#      DEPLOY_LOCK_WAIT (900), DEPLOY_KEEP_PREV (5), DEPLOY_SITE_URL, DEPLOY_REPO,
#      DEPLOY_KEEP_STAGE=1 (debug). No password is ever read, printed or stored here.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/lib.sh
. "$HERE/lib.sh"
REPO="${DEPLOY_REPO:-$(cd "$HERE/.." && pwd)}"

usage() { sed -n '2,12p' "$HERE/deploy.sh" | sed 's/^# \{0,1\}//'; }

MODE=deploy; SKIP_DRY=0; I_KNOW=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check) MODE=check ;;
    --rollback) MODE=rollback ;;
    --status) MODE=status ;;
    --selftest) MODE=selftest ;;
    --skip-dry-run) SKIP_DRY=1 ;;
    --i-know) I_KNOW=1 ;;
    -h|--help) usage; exit 0 ;;
    *) say "unknown argument: $1"; usage; exit 1 ;;
  esac
  shift
done

target_desc() {
  if [ "$DEPLOY_TRANSPORT" = local ]; then echo "local simulated remote HOME=${DEPLOY_REMOTE_HOME:-?}"
  else echo "$DEPLOY_HOP1 -> $DEPLOY_HOP2:~/whattodo72.com/test"; fi
}

secs() { echo $(( $(date +%s) - $1 ))s; }

# step <exit-code-on-failure> <label> <rf_function> [args]: run one remote step.
step() {
  local code="$1" label="$2" t0 rc=0
  shift 2
  t0=$(date +%s)
  remote "$@" || rc=$?
  if [ "$rc" -eq 0 ]; then say "  ($label ok, $(secs "$t0"))"; return 0; fi
  if [ "$rc" -eq 255 ]; then say "  $label: could not reach the remote (ssh exit 255)"; fi
  return "$code"
}

do_status() {
  local out dep head
  out="$(remote rf_status)" || { say "status: could not reach the remote"; exit 1; }
  printf '%s\n' "$out"
  dep="$(printf '%s\n' "$out" | sed -n 's/^deployed_sha=//p')"
  head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
  say "HEAD=$head"
  if [ "$dep" = "$head" ]; then say "status: prod runs HEAD"
  elif [ "$dep" = none ]; then say "status: prod has no .deployed-sha (never deployed by ops/deploy.sh)"
  else say "status: prod runs $dep, which is not HEAD"; fi
  exit 0
}

do_rollback() {
  local rc=0
  say "rollback on $(target_desc): swap build with the newest build.prev-* (under the build lock)"
  remote rf_rollback || rc=$?
  case "$rc" in
    0) say "ROLLED BACK. Running --rollback again swaps forward to what was just replaced."; exit 0 ;;
    2) say "REFUSED: nothing to roll back to"; exit 2 ;;
    255) say "FAILED: could not reach the remote; run --status to see where prod stands"; exit 5 ;;
    *) say "FAILED: rollback did not complete (see above)"; exit 5 ;;
  esac
}

do_deploy() {
  local sha subj rc=0 t0 dirty
  if [ "$SKIP_DRY" = 1 ] && [ "$I_KNOW" != 1 ]; then
    say "REFUSED: --skip-dry-run skips the only live-source proof; add --i-know to do it anyway"
    exit 2
  fi
  cd "$REPO" || exit 1
  if ! git rev-parse --git-dir >/dev/null 2>&1; then say "REFUSED: $REPO is not a git repository"; exit 2; fi
  dirty="$(git status --porcelain 2>&1)"
  if [ -n "$dirty" ]; then
    say "REFUSED: the working tree is not clean (commit or stash first):"
    printf '%s\n' "$dirty" | head -10 | sed 's/^/  /'
    exit 2
  fi
  sha="$(git rev-parse HEAD)"
  if [ -z "$(git branch -r --contains HEAD 2>/dev/null)" ]; then
    say "REFUSED: HEAD ${sha:0:12} is not on any remote branch; push it first"
    exit 2
  fi
  subj="$(git log -1 --format=%s HEAD)"
  t0=$(date +%s)
  say "deploy ${sha:0:12} \"$subj\" to $(target_desc)"
  say "plan:"
  say "  1 stage      git archive HEAD -> ~/whattodo72.com/test/.deploy/$sha/"
  say "  2 preflight  remote node --check, bash -n, tests/run-all.sh"
  if [ "$SKIP_DRY" = 1 ]; then
    say "  3 dry run    SKIPPED (--skip-dry-run --i-know): no live-source proof for this commit"
  else
    say "  3 dry run    DRY_RUN=1 build-site.sh in a sandbox ROOT (real network, ~4 min)"
  fi
  if [ "$MODE" = check ]; then say "  4 swap       not in --check mode"
  else say "  4 swap       under the build lock (wait up to ${DEPLOY_LOCK_WAIT}s); keep ${DEPLOY_KEEP_PREV} build.prev-*"; fi
  say "nothing changes on prod before step 4."

  say "1 stage"
  step 3 stage rf_begin "$sha" || exit $?
  git archive --format=tar HEAD | remote_extract "whattodo72.com/test/.deploy/$sha"
  local pst="${PIPESTATUS[0]} ${PIPESTATUS[1]}"
  if [ "$pst" != "0 0" ]; then
    say "  FAIL could not copy the commit to the remote"
    remote rf_discard "$sha" >/dev/null 2>&1
    exit 3
  fi
  say "  staged ${sha:0:12}"

  say "2 preflight"
  step 3 preflight rf_preflight "$sha" || { say "PREFLIGHT FAILED: prod untouched"; exit 3; }

  if [ "$SKIP_DRY" = 1 ]; then
    say "3 dry run: WARNING skipped by --skip-dry-run --i-know"
  else
    say "3 dry run"
    step 4 "dry run" rf_dryrun "$sha" || { say "DRY RUN FAILED: prod untouched"; exit 4; }
  fi

  if [ "$MODE" = check ]; then
    remote rf_discard "$sha" >/dev/null 2>&1
    say "CHECK OK: ${sha:0:12} passed preflight$( [ "$SKIP_DRY" = 1 ] || echo ' and the dry run' ); prod untouched ($(secs "$t0"))"
    exit 0
  fi

  say "4 swap"
  remote rf_swap "$sha" || rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 255 ]; then say "SWAP: lost the connection; run --status to see where prod stands"
    else say "SWAP FAILED (see above)"; fi
    exit 5
  fi
  say "DEPLOYED ${sha:0:12} ($(secs "$t0")). Undo: bash ops/deploy.sh --rollback"
  exit 0
}

# ============================== selftest =====================================
# Offline, against a simulated remote HOME, through the real remote()/rf_* code
# (DEPLOY_TRANSPORT=local). The payload is a small fixture repo built from this
# tree's real build-site.sh, validate-feed.mjs, record-run.mjs, run-all.sh, with
# the stub fetch.mjs from tests/fixtures, committed and pushed to a local bare origin.
selftest() {
  local SRC H T R BARE PASS=0 FAIL=0 CASES=0 T0 LW=30
  ST=""; HOLDER=""; OLDPID=""      # global: the EXIT trap runs after this function returns
  SRC="$(cd "$HERE/.." && pwd)"
  T0=$(date +%s)
  command -v git >/dev/null || { say "SKIP selftest: git not found"; return 0; }
  ST="$(mktemp -d "${TMPDIR:-/tmp}/deploy-selftest.XXXXXX")"; ST="$(cd "$ST" && pwd -P)"
  H="$ST/home"; T="$H/whattodo72.com/test"; R="$ST/src"; BARE="$ST/origin.git"
  st_cleanup() {
    [ -n "$HOLDER" ] && kill "$HOLDER" 2>/dev/null
    [ -n "$OLDPID" ] && kill "$OLDPID" 2>/dev/null
    if [ "${DEPLOY_SELFTEST_KEEP:-0}" = 1 ]; then say "kept $ST"; else rm -rf "$ST"; fi
  }
  trap st_cleanup EXIT

  ok() {                              # ok <name> <0|1> [output-file]
    if [ "$2" = 0 ]; then PASS=$((PASS + 1)); say "  ok   $1"
    else FAIL=$((FAIL + 1)); say "  FAIL $1"; [ -n "${3:-}" ] && [ -f "$3" ] && tail -30 "$3" | sed 's/^/        /'; fi
  }
  check() { local n="$1" o="$2"; shift 2; if "$@"; then ok "$n" 0; else ok "$n" 1 "$o"; fi; }
  case_start() { CASES=$((CASES + 1)); say "case $CASES: $1"; }
  stgit() { git -C "$R" -c user.name=deploy-selftest -c user.email=selftest@example.invalid \
              -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"; }
  commit_push() { stgit add -A && stgit commit -q -m "$1" && stgit push -q origin HEAD:main 2>/dev/null; }
  hashall() { if command -v md5sum >/dev/null; then xargs md5sum; else xargs md5 -r; fi; }
  # manifest <full|live>: md5 of every prod file (live: without build.prev-*);
  # .build.lock (empty, state) and .deploy/ (staging) are not prod content.
  manifest() {
    (cd "$H/whattodo72.com" && find . -type f ! -path ./test/.build.lock ! -path './test/.deploy/*' -print \
        | { if [ "$1" = live ]; then grep -v '^\./test/build\.prev-'; else cat; fi; } \
        | LC_ALL=C sort | hashall | awk '{print $1, $2}')
  }
  prevs() { (cd "$T" && ls -d build.prev-* 2>/dev/null | LC_ALL=C sort); }
  nprev() { prevs | grep -c . || true; }
  # run <label> [deploy.sh args]: the REAL ops/deploy.sh; output in $ST/<label>.out, status in RC
  run() {
    local label="$1"; shift
    (cd "$R" && env DEPLOY_TRANSPORT=local DEPLOY_REMOTE_HOME="$H" DEPLOY_REPO="$R" \
        DEPLOY_SITE_URL="http://127.0.0.1:9" DEPLOY_LOCK_WAIT="$LW" DEPLOY_FAULT="${FAULT:-}" \
        STUB_FEED="$R/tests/fixtures/feed-good.json" bash "$HERE/deploy.sh" "$@") > "$ST/$label.out" 2>&1
    RC=$?
  }
  hold_lock() {                       # hold_lock <secs>: one process holds T/.build.lock; sets HOLDER
    rm -f "$ST/.held"
    if command -v flock >/dev/null; then
      sh -c 'exec 8>>"$1"; flock 8 && : > "$2" && exec sleep "$3"' sh "$T/.build.lock" "$ST/.held" "$1" &
    else
      perl -MFcntl=:flock -e 'open(F, ">>", $ARGV[0]) or die; flock(F, LOCK_EX) or die;
        open(G, ">", $ARGV[1]); close G; sleep $ARGV[2]' "$T/.build.lock" "$ST/.held" "$1" &
    fi
    HOLDER=$!
    local i; for i in $(seq 1 50); do [ -e "$ST/.held" ] && return 0; sleep 0.1; done
    return 1
  }

  say "deploy selftest: node $(node -v), bash $BASH_VERSION, flock=$(command -v flock >/dev/null && echo yes || echo 'no (perl)'), sandbox $ST"

  # ---- fixture repo (the "Mac" side) ----
  mkdir -p "$R/build" "$R/tests/fixtures" "$R/ops" || return 1
  { awk '/^const CATEGORIES *= *\[/,/^\];/' "$SRC/build/fetch.mjs"; cat "$SRC/tests/fixtures/stub-fetch.mjs"; } > "$R/build/fetch.mjs"
  cp "$SRC/build/validate-feed.mjs" "$SRC/build/record-run.mjs" "$SRC/build/source-floors.json" "$SRC/build/test-imports.mjs" "$R/build/"
  cp "$SRC/build-site.sh" "$SRC/run-levels.sh" "$SRC/pinkpages-levels.orig" "$SRC/prices-resolved.json" "$SRC/.htaccess" "$SRC/.gitignore" "$R/"
  cp "$SRC/tests/run-all.sh" "$R/tests/"
  cp "$SRC/tests/fixtures/feed-good.json" "$R/tests/fixtures/"
  cp "$HERE/deploy.sh" "$HERE/lib.sh" "$R/ops/"
  echo v1 > "$R/build/version.txt"
  git init -q --bare "$BARE" && git init -q "$R" && git -C "$R" symbolic-ref HEAD refs/heads/main \
    && stgit remote add origin "$BARE" && commit_push "v1" && stgit fetch -q origin \
    || { say "FAIL could not build the fixture repo"; return 1; }

  # ---- simulated prod (the "DreamHost" side): an old, pre-lock tree ----
  mkdir -p "$T/build" "$T/logs"
  cp "$R/build/"*.mjs "$R/build/source-floors.json" "$T/build/"
  echo old > "$T/build/version.txt"
  echo "stray hand-edited copy" > "$T/build/fetch.mjs.bak"
  node -e 'const j=require(process.argv[1]);j.generatedAt="2026-10-01T00:00:00.000Z";require("fs").writeFileSync(process.argv[2],JSON.stringify(j))' \
    "$R/tests/fixtures/feed-good.json" "$T/build/events.json"
  cp "$T/build/events.json" "$H/whattodo72.com/events.json"
  echo '{"days":["2026-10-01"],"events":[{"id":"dc1"}]}' > "$T/build/dc-events.json"
  echo '{"levels":{"a.jpg":1}}' > "$T/build/image-levels.json"
  echo '{"generatedAt":"2026-10-01T00:00:00.000Z","sources":{}}' > "$T/build/.source-report.json"
  echo "old fetch log" > "$T/build/.fetch.log"
  cat > "$T/build-site.sh" <<'OLD'
#!/usr/bin/env bash
# stand-in for the pre-lock prod build-site.sh: no flock, runs until OLD_GO exists
echo "old build: started" > "${OLD_MARK:-/dev/null}"
while [ -n "${OLD_GO:-}" ] && [ ! -e "$OLD_GO" ]; do sleep 0.2; done
echo "old build: finished cleanly" >> "${OLD_MARK:-/dev/null}"
exit 0
OLD
  chmod 755 "$T/build-site.sh"
  printf '#!/usr/bin/env bash\necho old levels\n' > "$T/run-levels.sh"; chmod 755 "$T/run-levels.sh"
  echo "old pinkpages" > "$T/pinkpages-levels.orig"
  echo '[]' > "$T/prices-resolved.json"
  # no .htaccess on the old tree: rollback must make it absent again
  for i in 1 2 3; do
    printf '{"ts":"2026-10-0%sT07:12:00Z","run_id":"r%s","outcome":"published","stage":"done","total":60,"sources":{"dothebay":60},"duration_s":200,"sha":null,"warnings":0,"fatal":[]}\n' "$i" "$i"
  done > "$T/logs/history.jsonl"
  echo "old index" > "$H/whattodo72.com/index.html"
  local FULL0 LIVE0 O t1 n before after
  FULL0="$(manifest full)"; LIVE0="$(manifest live)"

  # ---- 1-3 refusals ----
  case_start "refused: dirty tree, unpushed HEAD, --skip-dry-run without --i-know (exit 2)"
  echo x > "$R/untracked.txt"; run dirty; rm -f "$R/untracked.txt"
  check "dirty tree -> exit 2, says so" "$ST/dirty.out" sh -c "[ $RC = 2 ] && grep -q 'not clean' '$ST/dirty.out'"
  echo v1b > "$R/build/version.txt"; stgit commit -qam "unpushed"; run unpushed; stgit reset -q --hard HEAD~1
  check "unpushed HEAD -> exit 2, says so" "$ST/unpushed.out" sh -c "[ $RC = 2 ] && grep -q 'not on any remote branch' '$ST/unpushed.out'"
  run skipdry --skip-dry-run
  check "--skip-dry-run alone -> exit 2" "$ST/skipdry.out" sh -c "[ $RC = 2 ] && grep -q 'i-know' '$ST/skipdry.out'"
  check "prod byte-identical (md5 manifest)" "" [ "$(manifest full)" = "$FULL0" ]

  # ---- 4 bad syntax ----
  case_start "bad syntax in a staged file -> exit 3, prod unchanged"
  echo 'export const x = ;' > "$R/build/broken.mjs"; commit_push "break"
  run badsyntax; O="$ST/badsyntax.out"
  check "exit 3" "$O" [ "$RC" = 3 ]
  check "names the file" "$O" grep -q 'FAIL node --check build/broken.mjs' "$O"
  check "prod byte-identical (md5 manifest), staging removed" "$O" sh -c "[ \"\$1\" = \"\$2\" ] && [ ! -e '$T/.deploy' ]" sh "$(manifest full)" "$FULL0"
  stgit rm -q build/broken.mjs; commit_push "unbreak"

  # ---- 5 dry run fails ----
  case_start "dry-run failure (staged build-site.sh exits 1) -> exit 4, prod unchanged"
  printf '#!/usr/bin/env bash\necho "stub build-site: simulated failure"\nexit 1\n' > "$R/build-site.sh"; commit_push "failing build"
  run dryfail; O="$ST/dryfail.out"
  check "exit 4" "$O" [ "$RC" = 4 ]
  check "shows the dry run output" "$O" grep -q 'simulated failure' "$O"
  check "prod byte-identical (md5 manifest), staging removed" "$O" sh -c "[ \"\$1\" = \"\$2\" ] && [ ! -e '$T/.deploy' ]" sh "$(manifest full)" "$FULL0"
  cp "$SRC/build-site.sh" "$R/build-site.sh"; commit_push "real build-site"

  # ---- 6 lock held -> timeout ----
  case_start "build lock held by another process -> waits, times out, exit 5, prod unchanged"
  hold_lock 60 || ok "lock holder started" 1
  LW=2; t1=$(date +%s); run locked; LW=30; n=$(( $(date +%s) - t1 )); O="$ST/locked.out"
  kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null; HOLDER=""
  check "exit 5" "$O" [ "$RC" = 5 ]
  check "waited for the lock, then gave up" "$O" sh -c "grep -q 'waiting up to 2s' '$O' && grep -q 'could not take the build lock' '$O'"
  check "prod byte-identical (md5 manifest), staging removed" "$O" sh -c "[ \"\$1\" = \"\$2\" ] && [ ! -e '$T/.deploy' ]" sh "$(manifest full)" "$FULL0"

  # ---- 7 failure inside the swap -> automatic rollback ----
  case_start "failure inside the swap -> automatic rollback, exit 5, prod unchanged"
  FAULT=swap; run fault; FAULT=""; O="$ST/fault.out"
  check "exit 5" "$O" [ "$RC" = 5 ]
  check "automatic rollback reported OK" "$O" grep -q 'automatic rollback OK' "$O"
  check "prod byte-identical (md5 manifest): build, scripts, no build.prev-*, no .htaccess" "$O" [ "$(manifest full)" = "$FULL0" ]

  # ---- 8 clean deploy during a running old (pre-lock) build-site.sh ----
  case_start "clean deploy swaps and records the sha (an old build-site.sh is mid-run)"
  OLD_MARK="$ST/old.mark" OLD_GO="$ST/old.go" bash "$T/build-site.sh" > "$ST/old.out" 2>&1 &
  OLDPID=$!
  for i in $(seq 1 50); do [ -s "$ST/old.mark" ] && break; sleep 0.1; done
  run deploy1; O="$ST/deploy1.out"
  check "exit 0, DEPLOYED" "$O" sh -c "[ $RC = 0 ] && grep -q '^DEPLOYED' '$O'"
  check "build/.deployed-sha = HEAD" "$O" [ "$(cat "$T/build/.deployed-sha" 2>/dev/null)" = "$(stgit rev-parse HEAD)" ]
  check "top-level scripts installed from the commit (incl. new .htaccess)" "$O" sh -c \
    "cmp -s '$R/build-site.sh' '$T/build-site.sh' && cmp -s '$R/run-levels.sh' '$T/run-levels.sh' && cmp -s '$R/.htaccess' '$T/.htaccess' && cmp -s '$R/pinkpages-levels.orig' '$T/pinkpages-levels.orig'"
  check "build/ is the commit's build/ (version.txt v1)" "$O" [ "$(cat "$T/build/version.txt")" = v1 ]
  check "one build.prev-*, holding the old tree and its scripts" "$O" sh -c \
    "[ \"\$(ls -d '$T'/build.prev-* | wc -l | tr -d ' ')\" = 1 ] && [ \"\$(cat '$T'/build.prev-*/version.txt)\" = old ] && grep -q 'old build' '$T'/build.prev-*/_scripts/build-site.sh && grep -qx .htaccess '$T'/build.prev-*/_scripts/.absent"
  check "staging dir removed" "$O" [ ! -e "$T/.deploy" ]
  check "dry run ran and validated" "$O" grep -q 'validate-feed: OK' "$O"
  check "the old build was still running during the swap" "$O" kill -0 "$OLDPID"
  : > "$ST/old.go"; wait "$OLDPID"; n=$?; OLDPID=""
  check "...and it finished cleanly on its old script (exit 0)" "$ST/old.out" sh -c "[ $n = 0 ] && grep -q 'finished cleanly' '$ST/old.mark'"

  # ---- 9 generated state ----
  case_start "generated state survives the deploy"
  p="$(prevs | tail -1)"
  for f in events.json dc-events.json image-levels.json .source-report.json .fetch.log; do
    check "build/$f carried over" "$O" cmp -s "$T/$p/$f" "$T/build/$f"
  done
  check "untracked build/fetch.mjs.bak not carried, reported, kept in $p" "$O" sh -c \
    "[ ! -e '$T/build/fetch.mjs.bak' ] && [ -e '$T/$p/fetch.mjs.bak' ] && grep -q 'not in the commit.*fetch.mjs.bak' '$O'"
  check "docroot and logs untouched" "$O" sh -c "cmp -s '$H/whattodo72.com/events.json' '$T/$p/events.json' && [ \"\$(wc -l < '$T/logs/history.jsonl' | tr -d ' ')\" = 3 ]"

  # ---- 10 rollback ----
  case_start "rollback restores the exact previous tree"
  run rb1 --rollback; O="$ST/rb1.out"
  check "exit 0" "$O" [ "$RC" = 0 ]
  check "live tree md5 manifest = before the deploy (build, scripts, docroot)" "$O" [ "$(manifest live)" = "$LIVE0" ]
  check ".htaccess absent again, no .deployed-sha" "$O" sh -c "[ ! -e '$T/.htaccess' ] && [ ! -e '$T/build/.deployed-sha' ]"
  check "rolled-back-from tree kept as build.prev-* (1 total)" "$O" [ "$(nprev)" = 1 ]
  run rb2 --rollback
  check "a second --rollback swaps forward again" "$ST/rb2.out" sh -c "[ $RC = 0 ] && [ \"\$(cat '$T/build/.deployed-sha')\" = '$(stgit rev-parse HEAD)' ] && cmp -s '$R/build-site.sh' '$T/build-site.sh'"

  # ---- 11 lock released while waiting ----
  case_start "lock held briefly -> deploy waits, then swaps"
  echo v2 > "$R/build/version.txt"; commit_push v2
  hold_lock 3 || ok "lock holder started" 1
  run waited; O="$ST/waited.out"; wait "$HOLDER" 2>/dev/null; HOLDER=""
  check "exit 0 after waiting for the lock" "$O" sh -c "[ $RC = 0 ] && grep -q 'build lock taken after' '$O'"
  check "v2 live" "$O" [ "$(cat "$T/build/version.txt")" = v2 ]

  # ---- 12 prune ----
  case_start "6th deploy prunes to 5 build.prev-*"
  for v in 3 4 5 6; do
    before="$(prevs)"
    echo "v$v" > "$R/build/version.txt"; commit_push "v$v"; run "prune$v" --skip-dry-run --i-know
    [ "$RC" = 0 ] || { ok "deploy v$v" 1 "$ST/prune$v.out"; break; }
  done
  O="$ST/prune6.out"; after="$(prevs)"
  check "exactly 5 build.prev-* after 6 deploys" "$O" [ "$(nprev)" = 5 ]
  check "the oldest was pruned, the newest 4 of the 5 before were kept" "$O" sh -c \
    "[ \"\$1\" = \"\$2\" ] && grep -q '^  pruned build.prev-' '$O'" sh "$(printf '%s\n' "$before" | tail -4)" "$(printf '%s\n' "$after" | head -4)"
  check "--skip-dry-run --i-know warns" "$O" grep -q 'WARNING skipped by --skip-dry-run' "$O"
  check "v6 live" "$O" [ "$(cat "$T/build/version.txt")" = v6 ]

  # ---- 13 status ----
  case_start "--status reports deployed sha vs HEAD and recent history"
  run status --status; O="$ST/status.out"
  check "exit 0, prod runs HEAD, history lines shown" "$O" sh -c "[ $RC = 0 ] && grep -q 'status: prod runs HEAD' '$O' && [ \"\$(grep -c '\"outcome\"' '$O')\" = 3 ]"

  # ---- 14 --check ----
  case_start "--check runs preflight and the dry run but never swaps"
  echo v7 > "$R/build/version.txt"; commit_push v7; before="$(manifest full)"
  run check --check; O="$ST/check.out"
  check "exit 0, CHECK OK, prod byte-identical" "$O" sh -c "[ $RC = 0 ] && grep -q '^CHECK OK' '$O' && [ \"\$1\" = \"\$2\" ] && [ ! -e '$T/.deploy' ]" sh "$(manifest full)" "$before"

  say "$PASS passed, $FAIL failed ($CASES cases, $(secs "$T0"))"
  [ "$FAIL" -eq 0 ]
}

case "$MODE" in
  selftest) selftest; exit $? ;;
  status) do_status ;;
  rollback) do_rollback ;;
  deploy|check) do_deploy ;;
esac
