"""Secrets and local settings. Nothing here is ever committed.

Each secret is looked up in this order, first hit wins:
  1. the process environment (e.g. `ELEVENLABS_API_KEY=... arduino-app-cli app start ...`)
  2. ~/.config/servo-strummer/secrets.env on the board (outside the app folder, so App Lab
     never syncs or overwrites it; chmod 600)
  3. servo-strummer/.env (the old location, still read so existing boards keep working)
Files are KEY=value lines with # comments.
"""

import os
from pathlib import Path

SECRET_KEYS = ("ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "GEMINI_API_KEY", "GEMINI_MODEL")
SECRETS_FILE = Path.home() / ".config" / "servo-strummer" / "secrets.env"


def read_env(path):
    out = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                out[key.strip()] = value.strip().strip("'\"")
    except OSError:
        pass  # missing file: that source just has nothing
    return out


def load_secrets(files, environ=None):
    """{key: value} for every SECRET_KEYS entry that is set somewhere; empty values don't count."""
    environ = os.environ if environ is None else environ
    sources = [environ] + [read_env(p) for p in files]
    out = {}
    for key in SECRET_KEYS:
        for src in sources:
            if src.get(key):
                out[key] = src[key]
                break
    return out
