#!/usr/bin/env bash
# Install, check or remove the whattodo72 watchdog cron entry (run on the Hermes VPS).
# Idempotent. Usage: install-watchdog.sh [--check|--remove]   (no flag = install)
set -euo pipefail

SCRIPT=/root/projects/whattodo72-site/ops/watchdog.py
LINE="*/30 * * * * flock -n /run/whattodo72-watchdog.lock timeout 120 python3 $SCRIPT >> /root/.local/state/whattodo72-watchdog.log 2>&1"
MARK="whattodo72-site/ops/watchdog.py"
CRONTAB_BIN=${CRONTAB_BIN:-crontab}
BACKUP_DIR=${BACKUP_DIR:-/root/backups}

current() { "$CRONTAB_BIN" -l 2>/dev/null || true; }
installed() { current | grep -qF "$MARK"; }

backup() {
  mkdir -p "$BACKUP_DIR"
  local f="$BACKUP_DIR/crontab-pre-whattodo72-watchdog-$(date +%Y%m%d-%H%M%S)"
  current > "$f"
  echo "crontab backed up to $f"
}

case "${1:-install}" in
  --check)
    if installed; then echo "installed"; else echo "not installed"; fi ;;
  --remove)
    if ! installed; then echo "not installed; nothing to remove"; exit 0; fi
    backup
    cur=$(current)
    printf '%s\n' "$cur" | { grep -vF "$MARK" || true; } | "$CRONTAB_BIN" -
    echo "removed" ;;
  install|--install)
    if installed; then echo "already installed"; exit 0; fi
    mkdir -p /root/.local/state
    backup
    cur=$(current)
    { [ -n "$cur" ] && printf '%s\n' "$cur"; echo "$LINE"; } | "$CRONTAB_BIN" -
    echo "installed" ;;
  *) echo "usage: $0 [--check|--remove]" >&2; exit 64 ;;
esac
