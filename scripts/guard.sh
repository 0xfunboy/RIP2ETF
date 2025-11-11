#!/usr/bin/env bash
set -euo pipefail

SEARCH_TERM='${string}-${string}-${string}-${string}-${string}'
MATCHES=""

if command -v rg >/dev/null 2>&1; then
  set +e
  MATCHES=$(rg -n --glob '*.ts' --glob '!**/node_modules/**' --fixed-strings "$SEARCH_TERM" packages 2>/dev/null)
  STATUS=$?
  set -e
  if [[ $STATUS -gt 1 ]]; then
    echo "rg failed with status $STATUS"
    exit $STATUS
  fi
else
  set +e
  MATCHES=$(grep -R -n --include='*.ts' --exclude-dir='node_modules' '\\$\\{string\\}-\\$\\{string\\}-\\$\\{string\\}-\\$\\{string\\}-\\$\\{string\\}' packages 2>/dev/null)
  STATUS=$?
  set -e
  if [[ $STATUS -gt 1 ]]; then
    echo "grep failed with status $STATUS"
    exit $STATUS
  fi
fi

if [[ -n "$MATCHES" ]]; then
  echo "ERROR: template-literal UUID types detected. Replace them with shared string aliases (UUID/ServerId)."
  echo "$MATCHES"
  exit 1
fi

exit 0
