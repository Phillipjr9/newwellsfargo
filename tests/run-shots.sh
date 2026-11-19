#!/usr/bin/env bash
# Starts the dev server, runs a browser script against it, then stops the server.
# Usage: tests/run-shots.sh <node-script> (env vars are passed through)
set -u
cd "$(dirname "$0")/.."

if ! ls "$HOME/.cache/ms-playwright" 2>/dev/null | grep -q chromium_headless_shell; then
  echo "Installing Chromium..."
  timeout 400 npx playwright install --with-deps chromium > /tmp/pw-install.log 2>&1 || tail -3 /tmp/pw-install.log
fi

npx vite --config vite.demo.config.ts --host 127.0.0.1 --port 5173 --strictPort > /tmp/dev.log 2>&1 &
SERVER=$!
for _ in $(seq 1 40); do
  curl -s -o /dev/null -m 2 http://127.0.0.1:5173/portal && break
  sleep 0.5
done

timeout "${RUN_TIMEOUT:-150}" node "$1"
STATUS=$?

kill "$SERVER" 2>/dev/null
pkill -f "vite --config vite.demo.config.ts" 2>/dev/null
exit $STATUS
