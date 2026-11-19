#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DATA_DIR="$(mktemp -d)"
PORT="${PORT:-$((5200 + $$ % 4000))}"
export DEMO_DATA_DIR="$DATA_DIR"
export DEMO_ADMIN_TOKEN="${DEMO_ADMIN_TOKEN:-browser-test-admin}"
if ! ls "$HOME/.cache/ms-playwright" 2>/dev/null | grep -q chromium_headless_shell; then
  npx playwright install --with-deps chromium >/dev/null
fi

./node_modules/.bin/vite --config vite.demo.config.ts --host 127.0.0.1 --port "$PORT" --strictPort \
  >"$DATA_DIR/vite.log" 2>&1 &
SERVER=$!
cleanup() { kill "$SERVER" 2>/dev/null || true; rm -rf "$DATA_DIR"; }
trap cleanup EXIT
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/admin" -o /dev/null; then break; fi
  sleep 0.5
done
TEST_ORIGIN="http://127.0.0.1:$PORT" node tests/admin.browser.cjs