#!/usr/bin/env bash
# Stub `node` for tests/build-site.test.sh (T14): makes chosen node launches fail
# the way DreamHost's node 18 does under its cgroup thread limit, then runs the
# real node. build-site.sh runs it through W72_NODE.
#
# Env:
#   STUB_NODE_REAL   the real node binary (required)
#   STUB_NODE_MATCH  extended regex over the joined arguments; only matching
#                    launches are counted and may fail (unset: none)
#   STUB_NODE_FAILS  how many matching launches fail before node runs (default 1)
#   STUB_NODE_MODE   abort  (prints pthread_create EAGAIN, dies of SIGABRT: 134)
#                    trap   (dies of SIGTRAP: 133)
#                    hang   (never exits)
#                    eagain (prints pthread_create EAGAIN, exit 1)
#                    exit:N (exit N, no message)
#   STUB_NODE_DELAY  seconds before failing (default 0)
#   STUB_NODE_STATE  file that gets one line per matching launch (required with MATCH)
if [ -n "${STUB_NODE_MATCH:-}" ] && printf '%s' "$*" | grep -qE "$STUB_NODE_MATCH"; then
  echo "$*" >> "$STUB_NODE_STATE"
  n=$(wc -l < "$STUB_NODE_STATE")
  if [ "$n" -le "${STUB_NODE_FAILS:-1}" ]; then
    sleep "${STUB_NODE_DELAY:-0}"
    case "${STUB_NODE_MODE:-abort}" in
      abort)  echo "node[$$]: pthread_create: Resource temporarily unavailable" >&2; kill -ABRT $$ ;;
      trap)   kill -TRAP $$ ;;
      hang)   exec sleep 600 ;;
      eagain) echo "node[$$]: pthread_create: Resource temporarily unavailable" >&2; exit 1 ;;
      exit:*) exit "${STUB_NODE_MODE#exit:}" ;;
    esac
    exit 99
  fi
fi
exec "$STUB_NODE_REAL" "$@"
