#!/usr/bin/env bash
# servo-strummer: Python must compile, and every pattern must encode into messages the sketch accepts
# (CI has no board or Arduino core, so this is the check that runs everywhere). The page's tests are in web/ (vitest).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m compileall -q servo-strummer/python >/dev/null
# the Python checks live in tests/python (stdlib unittest, no installs)
python3 -I -m unittest discover -s tests/python -t tests/python
echo "servo_strummer_test: ok"
