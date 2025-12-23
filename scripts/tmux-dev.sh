#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/.pids"

SESSION="${TMUX_SESSION:-resume-agent}"
WEB_LOG="$PID_DIR/web.log"
WORKER_LOG="$PID_DIR/worker.log"

mkdir -p "$PID_DIR"

if ! command -v tmux >/dev/null 2>&1; then
  echo "❌ tmux not found."
  echo "   Install: brew install tmux"
  echo
  echo "▶ Fallback: starting services and streaming logs in this terminal..."
  "$ROOT_DIR/scripts/dev.sh" start
  echo
  echo "=== worker.log (follow) ==="
  tail -n 200 -f "$WORKER_LOG" &
  TAIL_W_PID=$!
  echo
  echo "=== web.log (follow) ==="
  tail -n 200 -f "$WEB_LOG" &
  TAIL_WEB_PID=$!

  echo
  echo "Press Ctrl+C to stop log streaming (services keep running)."
  trap 'kill $TAIL_W_PID $TAIL_WEB_PID 2>/dev/null || true' INT TERM
  wait
  exit 0
fi

# Start services first (with health check)
"$ROOT_DIR/scripts/dev.sh" start

# If session already exists, attach
if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux attach -t "$SESSION"
  exit 0
fi

tmux new-session -d -s "$SESSION" -n logs

# Pane layout: left worker, right web
tmux send-keys -t "$SESSION:logs" "cd '$ROOT_DIR' && echo '== worker.log ==' && tail -n 200 -f '$WORKER_LOG'" C-m
tmux split-window -h -t "$SESSION:logs"
tmux send-keys -t "$SESSION:logs.1" "cd '$ROOT_DIR' && echo '== web.log ==' && tail -n 200 -f '$WEB_LOG'" C-m
tmux select-layout -t "$SESSION:logs" even-horizontal

tmux new-window -t "$SESSION" -n ctrl
tmux send-keys -t "$SESSION:ctrl" "cd '$ROOT_DIR' && echo 'Commands:' && echo '  ./scripts/dev.sh status' && echo '  ./scripts/dev.sh stop' && echo '  ./scripts/dev.sh restart' && echo '' && bash" C-m

tmux select-window -t "$SESSION:logs"
tmux attach -t "$SESSION"
