#!/usr/bin/env bash
# Run the PRODUCTION levels algorithm on DreamHost, self-contained.
#
# pinkpages-levels.orig is a byte-for-byte copy of the VPS's
# /usr/local/bin/pinkpages-levels (md5 41558e46e27df4d32cfc8a10b669c364).
# The algorithm — percentiles, clamps, thumbnail size, alpha flatten, cache
# semantics — is NOT modified. Only two path constants are redirected, because
# this account cannot write /var/cache and the test tree is not the VPS docroot:
#
#     DOC       -> the directory passed as $1 (feed + output live together)
#     CACHE_DIR -> ~/.cache/pinkpages-levels
#
# That is done by rewriting exactly those two assignments into a temp copy at
# run time, so the shipped source stays identical to prod and can be diffed
# against it. If either substitution fails to apply, this aborts rather than
# silently running with the wrong paths.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORIG="$HERE/pinkpages-levels.orig"
DOC="${1:?usage: run-levels.sh <docroot-dir>}"
CACHE_DIR="$HOME/.cache/pinkpages-levels"
VENV="$HOME/.venv-pp"

[ -f "$ORIG" ]            || { echo "levels: missing $ORIG" >&2; exit 1; }
[ -x "$VENV/bin/python" ] || { echo "levels: missing venv python at $VENV" >&2; exit 1; }
[ -f "$DOC/events.json" ] || { echo "levels: no feed at $DOC/events.json" >&2; exit 1; }

mkdir -p "$CACHE_DIR"

RUN=$(mktemp "$HERE/.levels-run.XXXXXX")
trap 'rm -f "$RUN"' EXIT

sed -e "s|^DOC = .*|DOC = os.environ.get(\"PINKPAGES_DOCROOT\", \"$DOC\")|" \
    -e "s|^CACHE_DIR = .*|CACHE_DIR = \"$CACHE_DIR\"|" \
    "$ORIG" > "$RUN"

grep -q "^DOC = .*$DOC" "$RUN"             || { echo "levels: DOC substitution failed" >&2; exit 1; }
grep -q "^CACHE_DIR = \"$CACHE_DIR\"" "$RUN" || { echo "levels: CACHE_DIR substitution failed" >&2; exit 1; }

PINKPAGES_DOCROOT="$DOC" "$VENV/bin/python" "$RUN" || exit $?

# Validate what landed. An empty or malformed image-levels.json makes every card
# fall back to identity (no levels) — a silent visual regression, not an error.
"$VENV/bin/python" - "$DOC/image-levels.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
assert isinstance(d, dict), "image-levels.json is not an object"
bad = [k for k, v in d.items() if not (isinstance(v, list) and len(v) == 2
                                       and all(isinstance(x, (int, float)) for x in v)
                                       and v[1] > v[0])]
if not d:
    sys.exit("levels: refusing to publish an empty image-levels.json")
if bad:
    sys.exit(f"levels: refusing to publish, {len(bad)} malformed entries")
print(f"levels: validated {len(d)} entries")
PY