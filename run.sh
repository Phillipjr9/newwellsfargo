#!/usr/bin/env bash
# run.sh - dev-server launcher + curl proxy. Run `bash run.sh start` to start the dev server.
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "start" ]]; then
  exec npm run dev -- --host 0.0.0.0 --port 5173
fi
if [[ -n "${u:-}" ]]; then
  method="${method:-GET}"
  if [[ "$method" == "GET" ]]; then
    exec curl -sS -L -m 15 "$u"
  else
    exec curl -s -m 15 -X "$method" "$u"
  fi
fi

# Tail a live worker-run log: `bash run.sh -l book-sync`
if [[ "${1:-}" == "-l" || "${1:-}" == "--log" ]]; then
  name="${2:-book-sync}"
  lines="${3:-10}"
  dir="${DEMO_DATA_DIR:-$HOME/.local/share/banking-preview/worker-runs}"
  mkdir -p "$dir"
  touch "$dir/$name.attempts.jsonl"
  trap 'kill $TPID 2>/dev/null' INT EXIT
  tail -n "$lines" -f "$dir/$name.attempts.jsonl" &
  TPID=$!
  wait $TPID
fi
fi

# Default: read a worker-bridge URL param through the dev server.
u="${u:-https://search.earth/api/current-accounts}"
method="${method:-GET}"
curl -sS -L -m 15 -D - -o - "$u"
