# hackathon

## Setup (each person, once)

```sh
gh auth login                     # your own GitHub account
gh repo clone JiSukh/hackathon && cd hackathon
claude                            # then say: "read CLAUDE.md and start"
```

Claude starts a watcher (`scripts/bus.sh watch` under its Monitor tool) per CLAUDE.md, so it
reacts to new tasks, questions and PRs within ~15s. Keep the Claude Code session open.

How the Claudes coordinate is in [CLAUDE.md](CLAUDE.md). Tests: `scripts/test.sh`.

## Servo Strummer page

The page is plain HTML/JS served by the App Lab `web_ui` brick from the UNO Q itself (no build step,
no CDN, system fonts only), so it loads fast off the board over the USB forward (`servo-strummer/open.sh`).
Design: "Paper": warm cream, ink text, deep red accent, serif headings and numbers. All colours,
radii and fonts are CSS variables in one `:root` block at the top of `assets/index.html`.

## Secrets (ElevenLabs voice)

API keys are never committed and never typed into the page. On the board:

```sh
mkdir -p ~/.config/servo-strummer
cp servo-strummer/secrets.example.env ~/.config/servo-strummer/secrets.env
chmod 600 ~/.config/servo-strummer/secrets.env   # then fill in ELEVENLABS_API_KEY
```

Environment variables of the same name override the file; `servo-strummer/.env` is still read as a fallback.
Restart the app after changing secrets. Without a key, typed commands still work; speech is off.

Because the board has no internet, ElevenLabs is called from the browser, so `GET /config` hands the key
to the page. It is only reachable over the localhost USB forward. If the board ever gets internet, the
next step is to proxy speech-to-text/text-to-speech through `main.py` so the key never leaves the board.

Voice commands: hold the button (or space bar) and say "play Travis picking", "stop", "faster",
"tempo ninety", "chord A minor", "how do I play F", "twelve bar blues", "chords G, D, E minor, C",
"clear the song". While a song plays, the next chord is called out a beat early.
Code: `assets/voice.js` (text -> command), `assets/eleven.js` (speech-to-text, text-to-speech, mic).
