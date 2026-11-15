"""Puts servo-strummer/python on sys.path so tests can import the strummer package."""

import sys
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parents[2] / "servo-strummer" / "python"
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))
