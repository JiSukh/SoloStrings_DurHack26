#!/usr/bin/env bash
# solo-strings: Python must compile, and every pattern must encode into messages the sketch accepts
# (no board or Arduino core needed, so this check runs anywhere).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m compileall -q solo-strings/python >/dev/null
# the Python checks live in tests/python (stdlib unittest, no installs)
python3 -I -m unittest discover -s tests/python -t tests/python
echo "solo_strings_test: ok"
