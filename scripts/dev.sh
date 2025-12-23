#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"
WORKER_DIR="$ROOT_DIR/worker-py"
PID_DIR="$ROOT_DIR/.pids"

WEB_PID="$PID_DIR/web.pid"
WORKER_PID="$PID_DIR/worker.pid"

WEB_LOG="$PID_DIR/web.log"
WORKER_LOG="$PID_DIR/worker.log"
WORKER_PIP_LOG="$PID_DIR/worker-pip.log"

WORKER_HOST="${WORKER_HOST:-127.0.0.1}"
WORKER_PORT="${WORKER_PORT:-8000}"
WEB_HOST="${WEB_HOST:-127.0.0.1}"
WEB_PORT="${WEB_PORT:-3000}"

mkdir -p "$PID_DIR"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "❌ Missing required command: $1"
    exit 1
  }
}

is_pid_running() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

# kill a process tree best-effort on macOS/Linux
kill_tree() {
  local pid="$1"
  if ! is_pid_running "$pid"; then
    return 0
  fi

  # children first (pgrep may miss some watcher trees; also try pkill -P)
  local children
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  if [ -n "${children:-}" ]; then
    for c in $children; do
      kill_tree "$c" || true
    done
  fi

  # best-effort: kill direct children
  pkill -P "$pid" 2>/dev/null || true

  kill "$pid" 2>/dev/null || true
}

kill_port_listeners() {
  local port="$1"
  local pids
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -n "${pids:-}" ]; then
    echo "⚠️  Found listeners on port $port: $pids"
    echo "⏹ Killing listeners on port $port..."
    for p in $pids; do
      kill "$p" 2>/dev/null || true
    done
    sleep 0.5
    pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
    if [ -n "${pids:-}" ]; then
      echo "⚠️  Still listening on $port, force killing: $pids"
      for p in $pids; do
        kill -9 "$p" 2>/dev/null || true
      done
    fi
  fi
}

wait_for_worker() {
  require_cmd curl

  echo "ℹ️  WORKER_HOST=${WORKER_HOST} WORKER_PORT=${WORKER_PORT}"

  local url_health="http://${WORKER_HOST}:${WORKER_PORT}/health"
  local url_openapi="http://${WORKER_HOST}:${WORKER_PORT}/openapi.json"

  local timeout_s="${WORKER_HEALTH_TIMEOUT:-120}"
  local sleep_s="${WORKER_HEALTH_INTERVAL:-0.5}"

  echo "⏳ Waiting for worker health check (timeout=${timeout_s}s)..."
  echo "   health:  $url_health"
  echo "   openapi: $url_openapi"

  local start_ts; start_ts="$(date +%s)"
  local last_rc=0

  while true; do
    # Allow curl failures without exiting the whole script (set -e)
    set +e
    curl -fsS "$url_health" >/dev/null 2>&1
    last_rc=$?
    set -e
    if [ $last_rc -eq 0 ]; then
      echo "✔ worker healthy: $url_health"
      return 0
    fi

    set +e
    curl -fsS "$url_openapi" >/dev/null 2>&1
    last_rc=$?
    set -e
    if [ $last_rc -eq 0 ]; then
      echo "✔ worker ready (openapi): $url_openapi"
      return 0
    fi

    local now_ts; now_ts="$(date +%s)"
    if (( now_ts - start_ts >= timeout_s )); then
      echo "❌ Worker did not become ready within ${timeout_s}s (last curl rc=${last_rc})"
      echo "   Tip: tail -n 200 $WORKER_LOG"
      tail -n 200 "$WORKER_LOG" || true
      return 1
    fi

    sleep "$sleep_s"
  done
}


wait_for_web() {
  require_cmd curl

  echo "ℹ️  WEB_HOST=${WEB_HOST} WEB_PORT=${WEB_PORT}"

  local url="http://${WEB_HOST}:${WEB_PORT}"
  local timeout_s="${WEB_HEALTH_TIMEOUT:-30}"
  local sleep_s="${WEB_HEALTH_INTERVAL:-0.5}"

  echo "⏳ Waiting for web to become ready (timeout=${timeout_s}s)..."
  echo "   url: $url"

  local start_ts; start_ts="$(date +%s)"
  local last_rc=0

  while true; do
    set +e
    curl -fsSI "$url" >/dev/null 2>&1
    last_rc=$?
    set -e
    if [ $last_rc -eq 0 ]; then
      echo "✔ web ready: $url"
      return 0
    fi

    local now_ts; now_ts="$(date +%s)"
    if (( now_ts - start_ts >= timeout_s )); then
      echo "❌ Web did not become ready within ${timeout_s}s (last curl rc=${last_rc})"
      echo "   Tip: tail -n 200 $WEB_LOG"
      tail -n 200 "$WEB_LOG" || true
      return 1
    fi

    sleep "$sleep_s"
  done
}


start_worker() {
  echo "▶ Starting worker (FastAPI)..."
  cd "$WORKER_DIR"

  require_cmd python3

  if [ ! -d .venv ]; then
    echo "⚠️  No .venv found, creating virtualenv"
    python3 -m venv .venv
  fi

  # shellcheck disable=SC1091
  source .venv/bin/activate

require_cmd pip
if [ "${WORKER_PIP_INSTALL:-0}" = "1" ] && [ -f requirements.txt ]; then
  echo "ℹ️  Installing worker deps (WORKER_PIP_INSTALL=1)..."
  pip install -r requirements.txt > "$WORKER_PIP_LOG" 2>&1
fi

  require_cmd uvicorn

  : > "$WORKER_LOG"

  # Use --app-dir to stabilize imports (especially when scripts run from elsewhere).
  # Also run via bash -lc to ensure venv activation works in nohup.
    nohup bash -lc "cd '$WORKER_DIR' && source .venv/bin/activate && python3 -m uvicorn src.app:app --app-dir '$WORKER_DIR' --host '$WORKER_HOST' --port '$WORKER_PORT' --log-level info" \
    >> "$WORKER_LOG" 2>&1 &

  # $! is the nohup-launched bash; still acceptable for stop/kill_tree.
  echo $! > "$WORKER_PID"
  echo "✔ worker started (pid=$(cat "$WORKER_PID"))  log=$WORKER_LOG"
}

start_web() {
  echo "▶ Starting web (Next.js)..."
  cd "$WEB_DIR"

  require_cmd npm

  if [ ! -f package-lock.json ]; then
    echo "⚠️  No package-lock.json found in web/. Running npm install (dev-friendly)."
    npm install
  else
    if [ "${DEV_USE_NPM_CI:-0}" = "1" ]; then
      npm ci
    else
      npm install
    fi
  fi

  : > "$WEB_LOG"

  # Run with DEBUG=next:* but do not rely on it to print to terminal (nohup -> log).
  nohup bash -lc "cd '$WEB_DIR' && DEBUG=next:* npm run dev -- -p '$WEB_PORT' -H '$WEB_HOST'" \
    >> "$WEB_LOG" 2>&1 &

  echo $! > "$WEB_PID"
  echo "✔ web started (pid=$(cat "$WEB_PID"))  log=$WEB_LOG"
}

stop_process() {
  local name="$1"
  local pid_file="$2"

  if [ -f "$pid_file" ]; then
    local pid; pid="$(cat "$pid_file")"
    if is_pid_running "$pid"; then
      echo "⏹ Stopping $name (pid=$pid)"
      kill_tree "$pid" || true
      sleep 0.5
      if is_pid_running "$pid"; then
        echo "⚠️  $name still running, force killing (pid=$pid)"
        kill -9 "$pid" 2>/dev/null || true
      fi
    else
      echo "ℹ️  $name pid file exists but process not running"
    fi
    rm -f "$pid_file"
  else
    echo "ℹ️  $name not running (no pidfile)"
  fi
}

status() {
  echo "=== Status ==="
  if [ -f "$WORKER_PID" ] && is_pid_running "$(cat "$WORKER_PID")"; then
    echo "worker: RUNNING (pid=$(cat "$WORKER_PID"))  log=$WORKER_LOG"
  else
    echo "worker: STOPPED"
  fi
  if [ -f "$WEB_PID" ] && is_pid_running "$(cat "$WEB_PID")"; then
    echo "web:    RUNNING (pid=$(cat "$WEB_PID"))  log=$WEB_LOG"
  else
    echo "web:    STOPPED"
  fi

  echo
  echo "Ports:"
  echo -n "  ${WORKER_PORT} listeners: "
  lsof -nP -iTCP:"$WORKER_PORT" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ' || true
  echo
  echo -n "  ${WEB_PORT} listeners:    "
  lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ' || true
  echo
}

case "${1:-start}" in
  start)
    # defensive cleanup: kill port listeners that block startup
    kill_port_listeners "$WORKER_PORT"
    kill_port_listeners "$WEB_PORT"

    start_worker
    wait_for_worker
    start_web
    wait_for_web

    echo
    echo "✅ All services started"
    echo "   Web:    http://${WEB_HOST}:${WEB_PORT}"
    echo "   Worker: http://${WORKER_HOST}:${WORKER_PORT}"
    echo "   Logs:   $PID_DIR (web.log, worker.log)"
    ;;
  stop)
    stop_process "web" "$WEB_PID"
    stop_process "worker" "$WORKER_PID"

    # also kill any stray listeners (common with watchers)
    kill_port_listeners "$WEB_PORT"
    kill_port_listeners "$WORKER_PORT"

    echo "✅ All services stopped"
    ;;
  restart)
    "$0" stop
    sleep 0.5
    "$0" start
    ;;
  status)
    status
    ;;
  *)
    echo "Usage: $0 [start|stop|restart|status]"
    exit 1
    ;;
esac
