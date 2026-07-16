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

# The `zip` CLI is not installed everywhere (notably this dev box); Python's
# zipfile writes the identical archive, so fall back to it rather than failing.
if command -v zip >/dev/null 2>&1; then
  zip -r -X "$OUT" manifest.json icons src \
    -x '*.DS_Store' -x '__MACOSX*' -x '*/.*' -x 'icons/*.svg' -x 'icons/*.sh' >/dev/null
else
  python3 - "$OUT" <<'PY'
import os, sys, zipfile

out = sys.argv[1]
skip_suffix = (".DS_Store", ".svg", ".sh")

def keep(path):
    parts = path.split(os.sep)
    if any(p.startswith(".") for p in parts):          # */.*
        return False
    if parts[0] == "__MACOSX":
        return False
    if path.endswith(".DS_Store"):
        return False
    if parts[0] == "icons" and path.endswith((".svg", ".sh")):
        return False
    return True

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    if keep("manifest.json"):
        z.write("manifest.json")
    for top in ("icons", "src"):
        for root, dirs, files in os.walk(top):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for f in sorted(files):
                p = os.path.join(root, f)
                if keep(p):
                    z.write(p)
PY
fi

echo
echo "Built $OUT"
python3 -c "import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); print(f'{len(z.namelist())} files, {sum(i.file_size for i in z.infolist())} bytes uncompressed')" "$OUT"
echo "manifest version: $(python3 -c "import sys, zipfile; print(zipfile.ZipFile(sys.argv[1]).read('manifest.json').decode())" "$OUT" | node -p "JSON.parse(require('fs').readFileSync(0)).version")"
