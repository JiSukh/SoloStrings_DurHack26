"""Local settings from servo-strummer/.env (never committed): KEY=value lines, # comments."""


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
        pass  # no .env: the page asks for the key instead
    return out
