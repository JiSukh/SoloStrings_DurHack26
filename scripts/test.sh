#!/usr/bin/env bash
# Single test entry point: CI and every Claude run this. Add new suites below.
set -euo pipefail
cd "$(dirname "$0")/.."
for t in tests/*_test.sh; do bash "$t"; done
# The sketch's pure C++ (sequencer.h, servo_out.h's edge plan) against the shared golden vectors.
if command -v g++ >/dev/null; then
  bin=$(mktemp -d)/sequencer_test
  g++ -std=c++11 -Wall -Wextra -Werror -I servo-strummer/sketch tests/cpp/sequencer_test.cpp -o "$bin"
  "$bin" tests/bar_vectors.json
else
  echo "sequencer_test: skipped (no g++)"
fi
# The web page (web/: TypeScript + Svelte): type check, then vitest. CI installs with npm ci first;
# locally, run `npm ci --prefix web` once.
if [ -d web/node_modules ]; then
  npm --prefix web run --silent check
  npm --prefix web test -- --run
elif [ -n "${CI:-}" ]; then
  echo "web: node_modules missing (CI must run npm ci --prefix web first)" >&2
  exit 1
else
  echo "web tests: skipped (run npm ci --prefix web)"
fi
