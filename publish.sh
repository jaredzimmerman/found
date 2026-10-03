#!/usr/bin/env bash
# Publish a candidate build to the live docroot.
#
# The gate (/usr/local/bin/pinkpages-gate) VALIDATES; it never writes — it
# prints and exits. Publishing is a separate step, and because it is separate it
# must be correct on its own.
#
# Two things this guards, both of which bit in practice:
#
#  1. The build must never replace a healthy listing with a degenerate one, so
#     the gate runs first and a non-zero rc aborts.
#  2. `mktemp` creates 0600 root-owned files. Copying into that path and
#     renaming it into place publishes a file nginx cannot read, which serves a
#     403 and blanks the page — the site looked fine on disk and dead in the
#     browser. So the mode is set explicitly before the rename, and the served
#     result is read back afterwards rather than assumed.
set -euo pipefail

SRC="${1:?usage: publish.sh <candidate-feed.json> [docroot]}"
DEST_DIR="${2:-/var/www/pinkpages.indigokarasu.com}"
# The feed NAME follows the source by default. It used to be a third positional
# defaulting to events.json, so `publish.sh dc-events.json` published the
# Washington build while comparing it against the San Francisco live file —
# 35 vs 192, under the 50% floor, refused every DC publish. Deriving the name
# from the source makes the one-argument call do the obvious thing; pass a
# third argument only to publish under a different name.
NAME="${3:-$(basename "$SRC")}"
DEST="$DEST_DIR/$NAME"
GATE=/usr/local/bin/pinkpages-gate
URL="https://pinkpages.indigokarasu.com/$NAME"

# Reject a name that is not a plain feed filename before it reaches a path.
case "$NAME" in
  *.json) ;;
  *) echo "ABORT: feed name must end in .json, got '$NAME'" >&2; exit 1 ;;
esac
case "$NAME" in
  */*|..*) echo "ABORT: feed name must not contain a path separator" >&2; exit 1 ;;
esac

# 1. Validate. Refuses a fragment, an empty build, or an unparseable file.
#    The live comparison is against THIS feed's own live copy, which DEST is.
"$GATE" "$SRC" "$DEST"

# 2. Stage beside the destination so the rename is atomic within one filesystem.
TMP=$(mktemp "$DEST_DIR/.$NAME.XXXXXX")
trap 'rm -f "$TMP"' EXIT
cat "$SRC" > "$TMP"

# 3. Re-validate the STAGED bytes, not the source: a partial copy would
#    otherwise pass validation and then fail to parse once renamed.
node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const e=Array.isArray(a.events)?a.events:null;if(!e||!e.length){console.error("ABORT: staged build has no events");process.exit(1)}console.log("  staged "+e.length+" events")' "$TMP"

# 4. mktemp's 0600 must not survive. nginx is not root; without this the
#    rename publishes an unreadable file and the page renders "presses stopped".
chmod 644 "$TMP"

# 5. Atomic swap, then read back from the SERVER, not the filesystem. The disk
#    can hold a correct file that is still unserved.
mv -f "$TMP" "$DEST"
trap - EXIT

status=$(curl -s -o /dev/null -w '%{http_code}' "$URL")
if [ "$status" != "200" ]; then
  echo "ABORT: after publish $NAME serves HTTP $status, not 200 — the page would render empty." >&2
  exit 1
fi
n=$(curl -s "$URL" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.log((a.events||a).length)})')
echo "  published $NAME: HTTP 200, $n events served"