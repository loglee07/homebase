#!/usr/bin/env bash
# Stops the Homebase dev server only if the listener on the port is a Next.js
# process whose working directory is this project. Never kills anything else.
set -euo pipefail
PORT="${1:-3000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PID="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
if [ -z "$PID" ]; then echo "nothing listening on :$PORT"; exit 0; fi
CWD="$(lsof -p "$PID" -a -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
CMD="$(ps -o command= -p "$PID")"
if [ "$CWD" != "$ROOT" ] || [[ "$CMD" != *next* ]]; then
  echo "refusing: PID $PID ($CMD, cwd $CWD) is not this project's Next server" >&2
  exit 1
fi
kill "$PID" && echo "stopped PID $PID on :$PORT"
