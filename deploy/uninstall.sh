#!/bin/bash
# Remove the login agent. Leaves the project and its data untouched.
set -euo pipefail
LABEL="com.sasanka.dashboard"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "==> Removed $LABEL"
