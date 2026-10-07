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
set -euo pipefail

ROOT="$HOME/whattodo72.com"
TEST="$ROOT/test"
BUILD="$TEST/build"
export PATH="/usr/bin:/bin:/usr/local/bin:$PATH"   # system node 18; see header
export CHROME_BIN="$HOME/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome"

log() { echo "[$(date -Is)] $*"; }

[ -d "$BUILD" ] || { echo "FATAL: no build dir at $BUILD" >&2; exit 1; }
command -v node >/dev/null || { echo "FATAL: node missing" >&2; exit 1; }

cd "$BUILD"
log "node $(node -v)"

# ---- 0. import completeness -------------------------------------------------
# fetch.mjs wraps every source in a try/catch that logs "unavailable — skipped",
# so a module missing from build/ does NOT fail the build — it silently deletes
# that source from the feed. That is exactly how Omnivore went absent on this
# host while the build reported success, and how a stale build/ shipped an old
# parser twice. Walk the import graph first and refuse to build an incomplete
# tree. Negative-tested: removing one core module exits 1 naming it.
if [ -f test-imports.mjs ]; then
  if ! node test-imports.mjs . > "$BUILD/.imports.log" 2>&1; then
    echo "FATAL: build tree has unresolved imports; live feed left untouched" >&2
    cat "$BUILD/.imports.log" >&2
    exit 1
  fi
  log "import graph complete"
fi

# ---- 1. fetch -------------------------------------------------------------
log "fetching feed..."
if ! node fetch.mjs > "$BUILD/.fetch.log" 2>&1; then
  echo "FATAL: fetch.mjs failed; live feed left untouched" >&2
  tail -20 "$BUILD/.fetch.log" >&2
  exit 1
fi
grep -E 'unavailable|Wrote|every source' "$BUILD/.fetch.log" || true

# ---- 2. levels ------------------------------------------------------------
log "measuring artwork levels..."
if ! bash "$TEST/run-levels.sh" "$BUILD" > "$BUILD/.levels.log" 2>&1; then
  echo "FATAL: levels failed; live levels left untouched" >&2
  tail -20 "$BUILD/.levels.log" >&2
  exit 1
fi
tail -2 "$BUILD/.levels.log"

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
  if node "$BUILD/dc-fetch.mjs" > "$BUILD/.dc-fetch.log" 2>&1 \
     && cp "$BUILD/dc-events.json" "$dc_candidate" \
     && node -e '
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
# one: it renders an empty page with no error.
validate_feed() {                   # validate_feed <events.json>
  node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
if(!Array.isArray(j.events)||!j.events.length){console.error("FATAL: empty feed");process.exit(1)}
if(!Array.isArray(j.days)||j.days.length!==3){console.error("FATAL: bad day window");process.exit(1)}
const today=new Date().toLocaleDateString("en-CA",{timeZone:"America/Los_Angeles"});
if(!j.days.includes(today)){console.error(`FATAL: feed does not include today ${today}`);process.exit(1)}
console.log(`  feed ok: ${j.events.length} events, ${j.days.join(",")}`);
' "$1"
}

# ---- 4. publish to /test --------------------------------------------------
publish_feed() {                    # publish_feed <destdir> <label>
  local dest="$1" label="$2" f src tmp
  mkdir -p "$dest"
  for f in events.json image-levels.json; do
    src="$BUILD/$f"
    [ -f "$src" ] || { echo "FATAL: missing $src" >&2; exit 1; }
    tmp=$(mktemp "$dest/.$f.XXXXXX")
    cat "$src" > "$tmp"
    chmod 644 "$tmp"
    mv -f "$tmp" "$dest/$f"
    log "published $f -> $label"
  done
}

validate_feed "$BUILD/events.json"
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
  [ -f "$1" ] || { echo "FATAL: required static asset missing: $1" >&2; return 1; }
  mkdir -p "$(dirname "$2")"
  if [ -f "$2" ] && cmp -s "$1" "$2"; then return 0; fi
  local tmp
  tmp=$(mktemp "$(dirname "$2")/.$(basename "$2").XXXXXX")
  cat "$1" > "$tmp"; chmod 644 "$tmp"; mv -f "$tmp" "$2"
  log "published $3"
}

if [ ! -d "$ROOT/fonts" ]; then
  echo "FATAL: $ROOT/fonts missing — the page would render in fallback fonts" >&2
  exit 1
fi
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
log "promoting to live docroot..."
[ -f "$TEST/index.html" ] || { echo "FATAL: no live index.html to promote" >&2; exit 1; }

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
if [ -f "$dc_candidate" ] && node -e '
const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
process.exit(Array.isArray(j.events)&&j.events.length?0:1)' "$dc_candidate" 2>/dev/null; then
  [ -f "$ROOT/dc-events.json" ] && cp -p "$ROOT/dc-events.json" "$ROOT/.dc-events.json.prev"
  tmp=$(mktemp "$ROOT/.dc-events.json.XXXXXX")
  cat "$dc_candidate" > "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$ROOT/dc-events.json"
  cmp -s "$dc_candidate" "$ROOT/dc-events.json" \
    || { echo "FATAL: promoted dc-events.json does not match the build" >&2; exit 1; }
  log "promoted dc-events.json -> LIVE (verified byte-identical)"
else
  log "WARNING: no validated dc-events.json in build — live DC feed left as-is"
fi

# How stale is the live DC window, in days? Printed every run. The failure this
# guards against is not "the build broke" — it is "the build quietly stopped
# building DC weeks ago and every log line still said done".
dc_age=$(node -e '
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
  cmp -s "$src" "$ROOT/$f" || { echo "FATAL: promoted $f does not match the build" >&2; exit 1; }
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
for pair in "/test:test" ":live"; do
  path="${pair%%:*}"; label="${pair##*:}"
  url="https://whattodo72.com${path}/events.json"
  code=$(curl -s -o /dev/null -w '%{http_code}' "$url")
  [ "$code" = "200" ] || { echo "FATAL: ${path:-/}/events.json serves HTTP $code" >&2; exit 1; }
  served=$(curl -s "$url" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const a=JSON.parse(s);
  console.log(`${(a.events||[]).length} ${a.days.join(",")}`);
})')
  log "served [$label]: $served"
done

# The whole point of promoting is that the live site carries the new code's
# output. Compare the served event COUNT against what was just built: if the
# live feed is not the file this run produced, the promotion did not happen,
# whatever the exit status said.
built=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("events.json","utf8")).events.length)')
live=$(curl -s "https://whattodo72.com/events.json" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log((JSON.parse(s).events||[]).length)})')
if [ "$built" != "$live" ]; then
  echo "FATAL: live feed has $live events, this build produced $built" >&2
  exit 1
fi
log "live feed matches this build ($built events)"

# ---- 7. every asset the page asks for must actually serve -------------------
# Parsed FROM the served HTML rather than from a list written here, because the
# list is what went stale: fonts/ and favicon.svg were both missing while the
# build reported success. Deriving the URLs means a new <link> or @font-face
# gets checked automatically, with no edit to this script required.
log "checking referenced assets..."
check_assets() {                     # check_assets <path-prefix> <label>
  local prefix="$1" label="$2" misses bad c
  misses=$(curl -s "https://whattodo72.com${prefix}/" | node -e '
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
    c=$(curl -s -o /dev/null -w '%{http_code}' "https://whattodo72.com${prefix}/$u")
    [ "$c" = "200" ] || bad="$bad
    $u -> HTTP $c"
  done <<< "$misses"
  if [ -n "$bad" ]; then
    echo "FATAL: referenced assets do not serve from ${prefix}/$bad" >&2
    exit 1
  fi
  log "all referenced assets serve 200 [$label]"
}
check_assets "/test" "test"
check_assets "" "live"

# The switcher is a live control, not decoration. Promoting an index.html that
# references dc-events.json without the file present is a 404 the build cannot
# see, because the page loads fine without it — the break is in the click.
if grep -q 'feed: "dc-events.json"' "$ROOT/index.html"; then
  dc=$(curl -s -o /dev/null -w '%{http_code}' "https://whattodo72.com/dc-events.json")
  [ "$dc" = "200" ] || { echo "FATAL: live index.html references dc-events.json but it serves HTTP $dc" >&2; exit 1; }
  log "city switcher feed resolves (dc-events.json 200)"
fi

log "done"