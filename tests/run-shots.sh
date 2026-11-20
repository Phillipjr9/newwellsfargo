#!/usr/bin/env bash
# Run one browser suite against its own development server and data directory.
set -euo pipefail
cd "$(dirname "$0")/.."
DATA_DIR="$(mktemp -d)"
PORT="${PORT:-$((5200 + $$ % 4000))}"
export DEMO_DATA_DIR="$DATA_DIR"
export TEST_ORIGIN="http://127.0.0.1:$PORT"
cleanup() {
  if [[ -n "${SERVER:-}" ]]; then kill "$SERVER" 2>/dev/null || true; wait "$SERVER" 2>/dev/null || true; fi
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT
if [[ -z "${CHROMIUM_EXECUTABLE:-}" ]] && ! ls "$HOME/.cache/ms-playwright" 2>/dev/null | grep -q chromium_headless_shell; then
  npx playwright install --with-deps chromium
fi
./node_modules/.bin/vite --config vite.demo.config.ts --host 127.0.0.1 --port "$PORT" --strictPort >"$DATA_DIR/vite.log" 2>&1 &
SERVER=$!
for _ in $(seq 1 40); do
  if ! kill -0 "$SERVER" 2>/dev/null; then break; fi
  if curl -sf -o /dev/null "$TEST_ORIGIN/api/demo/session"; then
    timeout "${RUN_TIMEOUT:-300}" node "$1"
    exit 0
  fi
  sleep 0.5
done
cat "$DATA_DIR/vite.log" >&2
exit 1
