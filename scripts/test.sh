#!/usr/bin/env bash
# Single test entry point: CI and every Claude run this. Add new suites below.
set -euo pipefail
cd "$(dirname "$0")/.."
for t in tests/*_test.sh; do bash "$t"; done
