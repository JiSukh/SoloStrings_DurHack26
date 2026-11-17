#!/usr/bin/env bash
# Builds solo-strings.zip for App Lab's import: the app folder, with this README inside it.
set -euo pipefail
cd "$(dirname "$0")/.."
out=$PWD/solo-strings.zip
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/solo-strings"
git ls-files -z solo-strings | while IFS= read -r -d '' f; do
  mkdir -p "$tmp/$(dirname "$f")"
  cp "$f" "$tmp/$f"
done
cp README.md "$tmp/solo-strings/README.md"
rm -f "$out"
(cd "$tmp" && zip -qr "$out" solo-strings)
echo "built $out"
