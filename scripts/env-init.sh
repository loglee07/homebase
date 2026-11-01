#!/usr/bin/env bash
# Creates .env.local from .env.example if it does not exist yet. Never prints file contents,
# never overwrites an existing .env.local.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
if [ -e "$ROOT/.env.local" ]; then
  echo ".env.local already exists; left unchanged. Edit it in your own editor."
  exit 0
fi
umask 077
cp "$ROOT/.env.example" "$ROOT/.env.local"
chmod 600 "$ROOT/.env.local"
echo "Created .env.local (mode 600). Open it in your editor and fill in the values."
