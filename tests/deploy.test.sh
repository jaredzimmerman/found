#!/usr/bin/env bash
# Offline test for ops/deploy.sh (plan C9): runs its selftest, which drives the
# REAL deploy/rollback code (ops/lib.sh rf_*) against a simulated remote HOME via
# DEPLOY_TRANSPORT=local. No network, no ssh; < 90 s. Auto-run by tests/run-all.sh.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$REPO/ops/deploy.sh" --selftest
