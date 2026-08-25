#!/bin/bash
# Install Flightdeck as a login agent. Re-run after changing node versions.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
LABEL="com.sasanka.flightdeck"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "==> Building"
npm run build

echo "==> Writing $TARGET"
sed -e "s#__NODE__#$(command -v node)#g" -e "s#__ROOT__#$ROOT#g" \
  "$ROOT/deploy/com.sasanka.flightdeck.plist" > "$TARGET"

echo "==> (Re)loading agent"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# bootout releases the label asynchronously — an immediate bootstrap can race
# it and fail with "Input/output error". Retry a few times before giving up.
for i in 1 2 3 4 5; do
  if launchctl bootstrap "gui/$(id -u)" "$TARGET" 2>/tmp/flightdeck-bootstrap-err; then
    break
  fi
  if [ "$i" -eq 5 ]; then
    cat /tmp/flightdeck-bootstrap-err >&2
    exit 1
  fi
  sleep 1
done
rm -f /tmp/flightdeck-bootstrap-err

echo "==> Done. http://127.0.0.1:3111   logs: data/dashboard.log"
