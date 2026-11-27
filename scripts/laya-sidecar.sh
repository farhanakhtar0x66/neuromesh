#!/bin/sh
# [F139 laya-gate] Run the Apache-2.0 Laya server (laya-serve) as a local sidecar for Neuromesh, in its own
# Python virtual environment. Neuromesh never installs or imports Laya itself; see docs/29-laya-sidecar.md.
#
#   scripts/laya-sidecar.sh install <pip spec or local path>   e.g. ~/src/laya  or  'laya==0.5.*'
#   scripts/laya-sidecar.sh start | stop | status | logs
#
# Environment:
#   NEUROMESH_LAYA_VENV   the virtual environment (default ~/.neuromesh/laya-venv)
#   NEUROMESH_LAYA_URL    where Neuromesh looks for it (default http://127.0.0.1:8787); its port is used here
#   NEUROMESH_LAYA_API_KEY  passed to the server as LAYA_API_KEY when set
#   LAYA_SERVE_ARGS       the server's own arguments, if its flags differ (default: --host 127.0.0.1 --port <port>)
#
# Not installed here, ever: vegaml-learn (noncommercial license). If you install it yourself for personal
# calibration, it stays in this venv, outside the Neuromesh repository (docs/29).

set -eu

VENV="${NEUROMESH_LAYA_VENV:-$HOME/.neuromesh/laya-venv}"
URL="${NEUROMESH_LAYA_URL:-http://127.0.0.1:8787}"
PORT="$(printf '%s' "$URL" | sed -n 's#.*:\([0-9][0-9]*\)/*$#\1#p')"
PORT="${PORT:-8787}"
RUN_DIR="$HOME/.neuromesh/laya"
PID_FILE="$RUN_DIR/laya-serve.pid"
LOG_FILE="$RUN_DIR/laya-serve.log"

running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

case "${1:-}" in
  install)
    if [ -z "${2:-}" ]; then
      echo "Give the package to install: a local checkout of Laya or an exact pip spec you trust." >&2
      echo "  scripts/laya-sidecar.sh install ~/src/laya" >&2
      exit 2
    fi
    case "$2" in
      *vegaml-learn*) echo "vegaml-learn is noncommercial; install it yourself if you want it (docs/29)." >&2; exit 2 ;;
    esac
    command -v python3 >/dev/null || { echo "python3 is needed (macOS: xcode-select --install, or Homebrew)." >&2; exit 1; }
    [ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
    "$VENV/bin/python" -m pip install --upgrade pip >/dev/null
    "$VENV/bin/python" -m pip install "$2"
    [ -x "$VENV/bin/laya-serve" ] || { echo "Installed, but $VENV/bin/laya-serve was not found: is this the Laya package?" >&2; exit 1; }
    echo "Installed. Start it with: scripts/laya-sidecar.sh start"
    ;;
  start)
    [ -x "$VENV/bin/laya-serve" ] || { echo "Not installed: scripts/laya-sidecar.sh install <package>" >&2; exit 1; }
    if running; then echo "Already running (pid $(cat "$PID_FILE"))."; exit 0; fi
    mkdir -p "$RUN_DIR"
    # Apple silicon: let PyTorch fall back to the CPU for operations MPS lacks.
    PYTORCH_ENABLE_MPS_FALLBACK=1 LAYA_API_KEY="${NEUROMESH_LAYA_API_KEY:-}" \
      nohup "$VENV/bin/laya-serve" ${LAYA_SERVE_ARGS:---host 127.0.0.1 --port "$PORT"} >"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
    echo "Started (pid $!), listening on 127.0.0.1:$PORT; log: $LOG_FILE"
    ;;
  stop)
    if running; then kill "$(cat "$PID_FILE")" && rm -f "$PID_FILE" && echo "Stopped."; else rm -f "$PID_FILE"; echo "Not running."; fi
    ;;
  status)
    if running; then echo "Running (pid $(cat "$PID_FILE")) on 127.0.0.1:$PORT."; else echo "Not running."; exit 1; fi
    ;;
  logs)
    tail -n 50 "$LOG_FILE"
    ;;
  *)
    sed -n '2,16p' "$0"
    exit 2
    ;;
esac
