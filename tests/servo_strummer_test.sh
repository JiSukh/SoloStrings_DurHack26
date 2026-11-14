#!/usr/bin/env bash
# servo-strummer: Python side must at least compile (CI has no board or Arduino core).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m py_compile servo-strummer/python/*.py
echo "servo_strummer_test: ok"
