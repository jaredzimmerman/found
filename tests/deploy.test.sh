#!/usr/bin/env bash
# Offline test for ops/deploy.sh (plan C9): runs its selftest, which drives the
# REAL deploy/rollback code (ops/lib.sh rf_*) against a simulated remote HOME via
# DEPLOY_TRANSPORT=local. No network, no ssh; < 90 s. Auto-run by tests/run-all.sh.
#
# Skipped inside a deploy's remote preflight (W72_DEPLOY_PREFLIGHT=1): there it
# would only simulate the host it is already running on, and it adds ~150 node
# launches to a host where node startup sometimes fails (see ops/lib.sh rf_run).
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${W72_DEPLOY_PREFLIGHT:-0}" = 1 ]; then
  echo "SKIP deploy selftest inside a deploy preflight (run it with: bash ops/deploy.sh --selftest)"
  exit 0
fi
exec bash "$REPO/ops/deploy.sh" --selftest
