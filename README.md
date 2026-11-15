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

The knob's button talks too: press it once (no holding), speak after the beep, and it stops
listening when you go quiet (or on a second press). A double tap is still "next pattern";
"previous pattern" is on the page and by voice only.

## Lessons

"Teach me Riptide" (or the Lesson card's buttons) loads the song, counts in, and has the robot
strum it once through at 60 BPM (the knob's tempo if one is plugged in). The chords slide
towards a line; you fret each one as it arrives, and the microphone marks the bar green (heard
the right chord) or red. "Teach me random chords" does the same with eight basic chords.

- Built-in songs (chords only, one per bar): `LESSONS` in `assets/lesson.js`.
- Any other song ("teach me Wonderwall") is looked up with Gemini, limited to the strummer's
  chords, and kept in the browser's localStorage so the second ask is instant and identical.
  Needs `GEMINI_API_KEY` in the secrets file (optional `GEMINI_MODEL`); the call goes from the
  browser, like ElevenLabs. Ask for the demo's songs once beforehand and check the chords.
- In debug mode (servos off, Sound on) the virtual guitar plays the bars through the speakers,
  which is enough for the microphone to mark them: a full run with no guitar.
Code: `assets/lesson.js` (songs, timing, verdicts, the lane), `assets/gemini.js` (song look-up).
