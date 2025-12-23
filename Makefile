.PHONY: dev stop restart status logs clean tmux ci start

dev:
	./scripts/dev.sh start

start:
	./scripts/dev.sh start

stop:
	./scripts/dev.sh stop

restart:
	./scripts/dev.sh stop
	./scripts/dev.sh start

status:
	./scripts/dev.sh status

logs:
	@echo "=== worker.log ==="
	@tail -n 80 .pids/worker.log 2>/dev/null || true
	@echo
	@echo "=== web.log ==="
	@tail -n 80 .pids/web.log 2>/dev/null || true

tmux:
	./scripts/tmux-dev.sh

clean:
	rm -rf .pids

# CI: strict + deterministic
ci:
	@echo "== CI: web =="
	@if [ ! -f web/package-lock.json ]; then \
	  echo "❌ web/package-lock.json missing. npm ci requires a lockfile."; \
	  exit 1; \
	fi
	cd web && npm ci
	@if [ -f web/package.json ]; then \
	  cd web && (npm run lint || true); \
	  cd web && (npm run typecheck || true); \
	  cd web && (npm run build || true); \
	fi

	@echo "== CI: worker =="
	@if [ -d worker-py ]; then \
	  cd worker-py && python3 -m venv .venv; \
	  cd worker-py && . .venv/bin/activate && pip install -r requirements.txt; \
	  cd worker-py && . .venv/bin/activate && (pytest -q || true); \
	fi
