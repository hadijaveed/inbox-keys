#!/usr/bin/env bash
# Build a Chrome Web Store package from the current source.
#
# Usage: ./release.sh
# Reads the version from manifest.json, runs the test suite, and writes
# dist/inbox-keys-<version>.zip containing exactly the runtime files
# (manifest + icons PNGs + src), with no junk or build sources.
set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/inbox-keys-${VERSION}.zip"

echo "Running tests..."
npm test

echo "Packaging ${OUT} ..."
mkdir -p dist
rm -f "$OUT"
zip -r -X "$OUT" manifest.json icons src \
  -x '*.DS_Store' -x '__MACOSX*' -x '*/.*' -x 'icons/*.svg' -x 'icons/*.sh' >/dev/null

echo
echo "Built $OUT"
unzip -l "$OUT" | tail -1
echo "manifest version: $(unzip -p "$OUT" manifest.json | node -p "JSON.parse(require('fs').readFileSync(0)).version")"
