# shellcheck shell=bash
# ops/lib.sh: shared helpers for ops/deploy.sh (plan contract C9). Sourced, never run.
#
# Two halves:
#   * local helpers (say, transport, remote, remote_extract) run on the Mac;
#   * rf_* functions run on the REMOTE. remote() ships their source text
#     (`declare -f`) plus one call line to `bash -s` on the far side, so the code
#     that runs on DreamHost is exactly the code in this file. With
#     DEPLOY_TRANSPORT=local the same script runs under a temp HOME on this
#     machine (that is how `ops/deploy.sh --selftest` exercises the real paths).
#
# Remote layout (C1):  T = $HOME/whattodo72.com/test
#   T/build/                    live source + generated state
#   T/build-site.sh ...         top-level scripts (W72_SCRIPTS)
#   T/.deploy/<sha>/            staged `git archive HEAD` (+ sandbox/ for the dry run)
#   T/build.prev-<utc>[-n]/     previous build trees, newest 5 kept; each holds
#                               _scripts/ = the top-level scripts it ran with
#   T/.build.lock               the build lock (build-site.sh takes it with flock -n)

# Deployed top-level files (C1). Each is installed by write-temp-then-mv.
W72_SCRIPTS="build-site.sh run-levels.sh pinkpages-levels.orig prices-resolved.json .htaccess"
# Generated state in build/ that a deploy carries into the new tree (plus every build/.* dotfile).
W72_STATE="events.json dc-events.json image-levels.json"

DEPLOY_TRANSPORT="${DEPLOY_TRANSPORT:-ssh}"
DEPLOY_HOP1="${DEPLOY_HOP1:-hermes}"
DEPLOY_HOP2="${DEPLOY_HOP2:-dh-backup}"
DEPLOY_LOCK_WAIT="${DEPLOY_LOCK_WAIT:-900}"
DEPLOY_KEEP_PREV="${DEPLOY_KEEP_PREV:-5}"
DEPLOY_SITE_URL="${DEPLOY_SITE_URL:-https://whattodo72.com}"
DEPLOY_KEEP_STAGE="${DEPLOY_KEEP_STAGE:-0}"
DEPLOY_FAULT="${DEPLOY_FAULT:-}"     # selftest only: "swap" fails the swap after the renames

say() { printf '%s\n' "$*"; }

# transport <remote shell command>: run it on the remote with this stdin.
transport() {
  case "$DEPLOY_TRANSPORT" in
    ssh)
      ssh -o BatchMode=yes "$DEPLOY_HOP1" "ssh -o BatchMode=yes $DEPLOY_HOP2 $(printf '%q' "$1")" ;;
    local)
      if [ -z "${DEPLOY_REMOTE_HOME:-}" ] || [ ! -d "${DEPLOY_REMOTE_HOME:-}" ]; then
        say "DEPLOY_TRANSPORT=local needs DEPLOY_REMOTE_HOME=<existing dir>" >&2
        return 255
      fi
      (cd "$DEPLOY_REMOTE_HOME" && HOME="$DEPLOY_REMOTE_HOME" bash -c "$1") ;;
    *)
      say "unknown DEPLOY_TRANSPORT '$DEPLOY_TRANSPORT' (ssh|local)" >&2
      return 255 ;;
  esac
}

# remote <rf_function> [args...]: run one rf_* function on the remote (script on stdin).
remote() {
  local fn="$1"
  shift
  {
    printf 'set -u\n'
    printf 'W72_SCRIPTS=%q\n' "$W72_SCRIPTS"
    printf 'W72_STATE=%q\n' "$W72_STATE"
    printf 'DEPLOY_LOCK_WAIT=%q\n' "$DEPLOY_LOCK_WAIT"
    printf 'DEPLOY_KEEP_PREV=%q\n' "$DEPLOY_KEEP_PREV"
    printf 'DEPLOY_SITE_URL=%q\n' "$DEPLOY_SITE_URL"
    printf 'DEPLOY_KEEP_STAGE=%q\n' "$DEPLOY_KEEP_STAGE"
    printf 'DEPLOY_FAULT=%q\n' "$DEPLOY_FAULT"
    # shellcheck disable=SC2046
    declare -f $(compgen -A function rf_)
    # The call is the last line, so bash has read the whole script before it runs;
    # nothing a child reads from stdin can eat script text.
    printf '%s' "$fn"
    [ "$#" -gt 0 ] && printf ' %q' "$@"
    printf ' </dev/null\n'
  } | transport "bash -s"
}

# remote_extract <dir relative to the remote HOME>: unpack the tar stream on stdin there.
remote_extract() {
  transport "mkdir -p '$1' && tar -xf - -C '$1'"
}

# ============================== remote side ==================================

rf_init() {
  T="$HOME/whattodo72.com/test"
  export PATH="/usr/bin:/bin:/usr/local/bin:$PATH"   # DH system node 18, as build-site.sh
  umask 022
}

rf_say() { printf '%s\n' "$*" 2>/dev/null || true; }

# rf_discard <sha>: remove the staging dir (and .deploy/ when it is left empty).
rf_discard() {
  [ -n "${T:-}" ] || rf_init
  if [ "$DEPLOY_KEEP_STAGE" = 1 ]; then rf_say "  staging kept: $T/.deploy/$1 (DEPLOY_KEEP_STAGE=1)"; return 0; fi
  rm -rf "$T/.deploy/$1"
  rmdir "$T/.deploy" 2>/dev/null
  return 0
}

# rf_begin <sha>: the remote tree must exist; clear a stale staging dir.
rf_begin() {
  rf_init
  if [ ! -d "$T/build" ]; then rf_say "  remote has no $T/build; nothing to deploy onto"; return 3; fi
  if ! command -v node >/dev/null 2>&1; then rf_say "  remote has no node on PATH"; return 3; fi
  if [ -e "$T/.deploy/$1" ]; then
    rf_say "  removing a stale staging dir .deploy/$1 (left by an interrupted deploy)"
    rm -rf "$T/.deploy/$1"
  fi
  mkdir -p "$T/.deploy" || return 3
  rf_say "  remote ok: $T (node $(node -v))"
}

# rf_preflight <sha>: syntax-check everything and run the offline suite with the remote's node.
rf_preflight() {
  rf_init
  local S="$T/.deploy/$1" f bad=0 n=0 log
  if ! cd "$S" 2>/dev/null; then rf_say "  staged tree $S missing"; rf_discard "$1"; return 3; fi
  log="$S/.preflight.log"
  rf_say "  node $(node -v), bash $BASH_VERSION"
  for f in $(find build -name '*.mjs' -type f ! -name '._*' | LC_ALL=C sort); do
    n=$((n + 1))
    if ! node --check "$f" > "$log" 2>&1; then
      bad=$((bad + 1)); rf_say "  FAIL node --check $f"; sed 's/^/      /' "$log" | head -15
    fi
  done
  rf_say "  node --check: $n module(s), $bad failed"
  n=0
  for f in $(find . \( -name .git -o -name node_modules -o -name fixtures -o -name sandbox \) -prune -o -name '*.sh' ! -name '._*' -type f -print | LC_ALL=C sort); do
    n=$((n + 1))
    if ! bash -n "$f" > "$log" 2>&1; then
      bad=$((bad + 1)); rf_say "  FAIL bash -n $f"; sed 's/^/      /' "$log" | head -15
    fi
  done
  rf_say "  bash -n: $n script(s)"
  if [ "$bad" -ne 0 ]; then rf_discard "$1"; return 3; fi
  if [ ! -f tests/run-all.sh ]; then rf_say "  FAIL no tests/run-all.sh in the commit"; rf_discard "$1"; return 3; fi
  if ! bash tests/run-all.sh > "$log" 2>&1; then
    rf_say "  FAIL tests/run-all.sh:"; grep -v '^PASS ' "$log" | tail -40 | sed 's/^/    /'
    rf_discard "$1"; return 3
  fi
  rf_say "  tests/run-all.sh: $(tail -1 "$log")"
  return 0
}

# rf_carry_state <from-build> <to-build>: copy generated state (C1) across.
# Every build/.* dotfile except .deployed-sha, which belongs to its own tree.
rf_carry_state() {
  local from="$1" to="$2" f p
  for f in $W72_STATE; do
    if [ -e "$from/$f" ]; then cp -p "$from/$f" "$to/$f" || return 1; fi
  done
  for p in "$from"/.[!.]* "$from"/..?*; do
    [ -e "$p" ] || continue
    f="${p##*/}"
    [ "$f" = .deployed-sha ] && continue
    rm -rf "${to:?}/$f"
    cp -pR "$p" "$to/$f" || return 1
  done
  return 0
}

# rf_dryrun <sha>: DRY_RUN=1 build of the staged tree against a sandbox ROOT that
# holds a copy of the live generated state and history. Real network.
rf_dryrun() {
  rf_init
  local S="$T/.deploy/$1" SB rc=0 f
  SB="$S/sandbox"
  rm -rf "$SB"
  mkdir -p "$SB/test/logs" || { rf_discard "$1"; return 4; }
  if ! cp -pR "$S/build" "$SB/test/build" || ! rf_carry_state "$T/build" "$SB/test/build"; then
    rf_say "  FAIL could not build the sandbox"; rf_discard "$1"; return 4
  fi
  for f in $W72_SCRIPTS; do
    if [ -e "$S/$f" ]; then cp -p "$S/$f" "$SB/test/$f"; fi
  done
  if [ -f "$T/logs/history.jsonl" ]; then cp -p "$T/logs/history.jsonl" "$SB/test/logs/history.jsonl"; fi
  rf_say "  DRY_RUN=1 ROOT=<sandbox> SITE_URL=$DEPLOY_SITE_URL bash build-site.sh"
  (cd "$SB/test" && env -u W72_UNDER_TIMEOUT -u W72_STARTED DRY_RUN=1 STAGE_ONLY=0 \
      ROOT="$SB" SITE_URL="$DEPLOY_SITE_URL" RUN_ID="deploy-dryrun-$(printf '%.12s' "$1")" \
      bash "$SB/test/build-site.sh") > "$S/.dryrun.log" 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    rf_say "  FAIL dry run exited $rc:"; tail -30 "$S/.dryrun.log" | sed 's/^/    /'
    rf_discard "$1"; return 4
  fi
  grep -E 'validate-feed:|dry run summary|^  [a-z0-9_.-]+: (ok|failed|skipped)|WARNING|outcome:' "$S/.dryrun.log" | head -40 | sed 's/^/    /'
  rm -rf "$SB"
  return 0
}

# ---- lock (fd 9 on T/.build.lock, same lock build-site.sh takes) -------------
rf_trylock() {                      # rf_trylock <seconds>; 0 = do not wait
  if command -v flock >/dev/null 2>&1; then
    if [ "$1" = 0 ]; then flock -n 9; else flock -w "$1" 9; fi
    return $?
  fi
  # No flock(1) (macOS): flock(2) the same open file description through perl.
  # The lock belongs to the description, which this shell keeps open on fd 9.
  perl -MFcntl=:flock -e '
    open(my $fh, ">&=", 9) or exit 2;
    my $end = time + $ARGV[0];
    while (1) {
      exit 0 if flock($fh, LOCK_EX | LOCK_NB);
      exit 1 if time >= $end;
      select(undef, undef, undef, 0.2);
    }' "$1"
}

rf_lock() {
  local t0
  t0=$(date +%s)
  exec 9>>"$T/.build.lock" || { rf_say "  cannot open $T/.build.lock"; return 1; }
  if rf_trylock 0; then rf_say "  build lock taken"; return 0; fi
  rf_say "  a build holds $T/.build.lock; waiting up to ${DEPLOY_LOCK_WAIT}s"
  if rf_trylock "$DEPLOY_LOCK_WAIT"; then
    rf_say "  build lock taken after $(( $(date +%s) - t0 ))s"
    return 0
  fi
  exec 9>&-
  rf_say "  FAIL could not take the build lock within ${DEPLOY_LOCK_WAIT}s; prod untouched"
  return 1
}

rf_unlock() { exec 9>&-; }

rf_prev_list() {                    # oldest first
  (cd "$T" && for d in build.prev-*; do [ -d "$d" ] && printf '%s\n' "$d"; done) | LC_ALL=C sort
}

rf_prev_name() {                    # a fresh build.prev-<utc>[-n]
  local base n=1 name
  base="build.prev-$(date -u +%Y%m%dT%H%M%SZ)"
  name="$base"
  while [ -e "$T/$name" ]; do name="$base-$n"; n=$((n + 1)); done
  printf '%s\n' "$name"
}

rf_prune() {
  local list n d
  list="$(rf_prev_list)"
  n=$(printf '%s\n' "$list" | grep -c . || true)
  [ "$n" -gt "$DEPLOY_KEEP_PREV" ] || return 0
  printf '%s\n' "$list" | head -n "$((n - DEPLOY_KEEP_PREV))" | while IFS= read -r d; do
    [ -n "$d" ] || continue
    rm -rf "${T:?}/$d" && rf_say "  pruned $d (keeping the newest $DEPLOY_KEEP_PREV)"
  done
}

# Report a build-site.sh that is running WITHOUT the lock (the pre-lock script).
# It keeps reading its old inode, so the swap does not break it.
rf_warn_unlocked_builds() {
  local pids
  pids=$(ps -u "$(id -u)" -o pid=,args= 2>/dev/null | grep -F "$T/build-site.sh" | grep -v grep | awk '{print $1}' | tr '\n' ' ')
  if [ -n "$pids" ]; then
    rf_say "  note: build-site.sh is running without the lock (pid ${pids% }); it keeps its old script (rename, not overwrite)"
  fi
}

# rf_exchange <mode> <new-build-dir> <scripts-src-dir> <sha>
#   mode deploy:   new = staged build, scripts from the staged tree, writes .deployed-sha
#   mode rollback: new = a build.prev-* dir, scripts from its _scripts/
# Caller holds the lock. On any failure every step taken is undone; returns 5.
rf_exchange() {
  local mode="$1" nb="$2" src="$3" sha="$4" prev save f p step=0 fail=""
  local restore=""
  prev="$(rf_prev_name)"
  save="$T/.deploy-save.$$"
  rm -rf "$save"
  mkdir -p "$save" || return 5
  # 0. off to the side: copy the current scripts (become $prev/_scripts) and carry state
  : > "$save/.absent"
  for f in $W72_SCRIPTS; do
    if [ -e "$T/$f" ]; then cp -p "$T/$f" "$save/$f" || fail="save $f"
    else printf '%s\n' "$f" >> "$save/.absent"; fi
  done
  if [ "$mode" = rollback ]; then
    restore="$T/.deploy-restore.$$"
    rm -rf "$restore"
    [ -z "$fail" ] && { mv "$nb/_scripts" "$restore" || fail="take $nb/_scripts"; }
    src="$restore"
  fi
  [ -z "$fail" ] && { rf_carry_state "$T/build" "$nb" || fail="carry generated state"; }
  if [ "$mode" = deploy ] && [ -z "$fail" ]; then
    # Files in the live build that are neither in the commit nor generated state.
    p=$( (cd "$T/build" && find . -type f) | LC_ALL=C sort > "$save/.old-list"
         (cd "$nb" && find . -type f) | LC_ALL=C sort > "$save/.new-list"
         LC_ALL=C comm -23 "$save/.old-list" "$save/.new-list" | sed 's#^\./##')
    if [ -n "$p" ]; then
      rf_say "  not in the commit, left in $prev: $(printf '%s\n' "$p" | head -8 | tr '\n' ' ')$( [ "$(printf '%s\n' "$p" | wc -l)" -gt 8 ] && echo '...')"
    fi
    rm -f "$save/.old-list" "$save/.new-list"
  fi
  # 1-3. the renames
  if [ -z "$fail" ]; then mv "$T/build" "$T/$prev" && step=1 || fail="move build -> $prev"; fi
  if [ -z "$fail" ]; then
    if [ -e "$T/$prev/_scripts" ]; then fail="$prev/_scripts already exists"
    else mv "$save" "$T/$prev/_scripts" && step=2 || fail="store scripts in $prev/_scripts"; fi
  fi
  if [ -z "$fail" ]; then
    if [ -e "$T/build" ]; then fail="$T/build reappeared"
    else mv "$nb" "$T/build" && step=3 || fail="move new tree -> build"; fi
  fi
  # 4. scripts: write-temp-then-mv (new inode; a running bash keeps its old script)
  if [ -z "$fail" ]; then
    step=4
    for f in $W72_SCRIPTS; do
      if [ -e "$src/$f" ]; then
        cp -p "$src/$f" "$T/.$f.deploy-new.$$" && mv -f "$T/.$f.deploy-new.$$" "$T/$f" || { fail="install $f"; break; }
      elif [ "$mode" = rollback ] && grep -qxF "$f" "$src/.absent" 2>/dev/null; then
        rm -f "$T/$f" || { fail="remove $f"; break; }
      elif [ "$mode" = deploy ]; then
        rf_say "  note: $f is not in the commit; the prod copy is left in place"
      fi
    done
  fi
  if [ -z "$fail" ] && [ "$DEPLOY_FAULT" = swap ]; then fail="injected fault (DEPLOY_FAULT=swap, selftest)"; fi
  if [ -z "$fail" ] && [ "$mode" = deploy ]; then
    { printf '%s\n' "$sha" > "$T/build/.deployed-sha.tmp.$$" && mv -f "$T/build/.deployed-sha.tmp.$$" "$T/build/.deployed-sha"; } \
      || fail="write .deployed-sha"
  fi
  # 5. verify what is now in place
  if [ -z "$fail" ]; then
    if [ -f "$T/build-site.sh" ] && ! bash -n "$T/build-site.sh" 2>/dev/null; then fail="installed build-site.sh does not parse"; fi
    for f in $W72_SCRIPTS; do
      if [ -z "$fail" ] && [ -e "$src/$f" ] && ! cmp -s "$src/$f" "$T/$f"; then fail="installed $f differs from its source"; fi
    done
    for f in $W72_STATE; do
      if [ -z "$fail" ] && [ -e "$T/$prev/$f" ] && ! cmp -s "$T/$prev/$f" "$T/build/$f"; then fail="carried $f differs"; fi
    done
    if [ -z "$fail" ] && [ "$mode" = deploy ] && [ "$(cat "$T/build/.deployed-sha" 2>/dev/null)" != "$sha" ]; then fail=".deployed-sha mismatch"; fi
  fi
  if [ -z "$fail" ]; then
    [ -n "$restore" ] && rm -rf "$restore"
    rf_say "  build -> $prev (its scripts in $prev/_scripts)"
    rf_say "  new build in place; scripts installed: $W72_SCRIPTS"
    return 0
  fi

  # ---- undo, newest step first ----
  rf_say "  FAIL swap: $fail"
  rf_say "  automatic rollback from step $step..."
  local undo_ok=1
  if [ "$step" -ge 4 ]; then
    for f in $W72_SCRIPTS; do
      if [ -e "$T/$prev/_scripts/$f" ]; then
        cp -p "$T/$prev/_scripts/$f" "$T/.$f.deploy-undo.$$" && mv -f "$T/.$f.deploy-undo.$$" "$T/$f" || undo_ok=0
      elif grep -qxF "$f" "$T/$prev/_scripts/.absent" 2>/dev/null; then
        rm -f "$T/$f" || undo_ok=0
      fi
    done
    rm -f "$T/build/.deployed-sha.tmp.$$"
  fi
  if [ "$step" -ge 3 ]; then
    if [ "$mode" = deploy ]; then rm -f "$T/build/.deployed-sha"; fi
    mv "$T/build" "$nb" || undo_ok=0
  fi
  if [ "$step" -ge 2 ]; then rm -rf "${T:?}/$prev/_scripts" || undo_ok=0; fi
  if [ "$step" -ge 1 ]; then
    if [ -e "$T/build" ]; then undo_ok=0; else mv "$T/$prev" "$T/build" || undo_ok=0; fi
  fi
  rm -rf "$save"
  if [ -n "$restore" ] && [ -d "$restore" ]; then mv "$restore" "$nb/_scripts" || undo_ok=0; fi
  if [ "$undo_ok" = 1 ]; then
    rf_say "  automatic rollback OK: prod is as it was before this run"
  else
    rf_say "  AUTOMATIC ROLLBACK INCOMPLETE: inspect $T (build, $prev, $nb) by hand"
  fi
  return 5
}

# rf_swap <sha>: holding the build lock, put the staged tree live.
rf_swap() {
  rf_init
  trap '' HUP PIPE                  # a dropped connection must not stop a swap half way
  local S="$T/.deploy/$1" rc=0
  if [ ! -d "$S/build" ]; then rf_say "  staged tree $S missing"; return 5; fi
  rf_lock || { rf_discard "$1"; return 5; }
  rf_warn_unlocked_builds
  rf_exchange deploy "$S/build" "$S" "$1" || rc=$?
  if [ "$rc" -eq 0 ]; then rf_prune; fi
  rf_unlock
  rf_discard "$1"
  return "$rc"
}

# rf_rollback: holding the lock, swap build with the newest build.prev-*.
rf_rollback() {
  rf_init
  trap '' HUP PIPE
  local target rc=0
  target="$(rf_prev_list | tail -1)"
  if [ -z "$target" ]; then rf_say "  no build.prev-* to roll back to"; return 2; fi
  if [ ! -d "$T/$target/_scripts" ]; then rf_say "  $target has no _scripts/; refusing (it was not made by ops/deploy.sh)"; return 2; fi
  rf_say "  rolling back to $target (deployed sha: $(cat "$T/$target/.deployed-sha" 2>/dev/null || echo none))"
  rf_lock || return 5
  rf_warn_unlocked_builds
  rf_exchange rollback "$T/$target" "" "" || rc=$?
  if [ "$rc" -eq 0 ]; then rf_prune; fi
  rf_unlock
  return "$rc"
}

rf_status() {
  rf_init
  rf_say "deployed_sha=$(cat "$T/build/.deployed-sha" 2>/dev/null || echo none)"
  rf_say "prev=$(rf_prev_list | tr '\n' ' ')"
  rf_say "history (last 3):"
  if [ -f "$T/logs/history.jsonl" ]; then tail -n 3 "$T/logs/history.jsonl" | sed 's/^/  /'
  else rf_say "  (no logs/history.jsonl)"; fi
}
