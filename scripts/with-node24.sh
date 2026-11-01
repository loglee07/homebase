#!/usr/bin/env bash
# Runs a command under Node 24 without changing the machine-wide `node`.
# Prepends Homebrew's keg-only node@24 to PATH, then refuses to run on any other major.
set -euo pipefail
for dir in "$(brew --prefix node@24 2>/dev/null || true)/bin" /opt/homebrew/opt/node@24/bin /usr/local/opt/node@24/bin; do
  if [ -x "$dir/node" ]; then export PATH="$dir:$PATH"; break; fi
done
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" != "24" ]; then
  echo "Finance Town needs Node 24 (found $(node -v) at $(command -v node)). Run: brew install node@24" >&2
  exit 1
fi
exec "$@"
