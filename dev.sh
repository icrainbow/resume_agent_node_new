#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Killing ports 3000 and 8000..."
lsof -ti:3000 | xargs kill -9 || true
lsof -ti:8000 | xargs kill -9 || true

echo "==> Activating venv from project root..."
if [ -d "$ROOT_DIR/.venv" ]; then
  source "$ROOT_DIR/.venv/bin/activate"
else
  echo "⚠️  No .venv found at project root, using system python"
fi

echo "==> Starting Python worker on :8000..."
cd "$ROOT_DIR/worker-py"
uvicorn src.app:app --host 127.0.0.1 --port 8000 --reload &

echo "==> Starting Next.js on :3000..."
cd "$ROOT_DIR/web"
NEXT_DISABLE_TURBOPACK=1 npm run dev

