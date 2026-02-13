#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not found. Install with: npm i -g pm2" >&2
  exit 1
fi

pnpm --filter @bbot/core-daemon build
pnpm --filter @bbot/bot-telegram build

pm2 restart ecosystem.config.js
