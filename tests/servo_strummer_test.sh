#!/usr/bin/env bash
# servo-strummer: Python must compile, and every pattern must encode into messages the sketch accepts
# (CI has no board or Arduino core, so this is the check that runs everywhere).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m compileall -q servo-strummer/python >/dev/null
# the Python checks live in tests/python (stdlib unittest, no installs)
python3 -I -m unittest discover -s tests/python -t tests/python
if command -v node >/dev/null; then node tests/listen_test.mjs; node tests/twin_test.mjs; node tests/voice_test.mjs; node tests/lesson_test.mjs; else echo "node tests: skipped (no node)"; fi
echo "servo_strummer_test: ok"
