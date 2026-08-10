#!/usr/bin/env bash
# Build static docs into dist/
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d node_modules/marked ]]; then
  echo "==> npm install"
  npm install --no-fund --no-audit
fi

echo "==> build"
node build.mjs

echo "==> serve locally with:"
echo "    python3 -m http.server -d dist 8080"
echo "    # or: npx --yes serve dist"
