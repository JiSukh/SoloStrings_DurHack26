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

## Voice control and coach (ElevenLabs)

On the strummer page, under **Voice control (ElevenLabs)**: paste an ElevenLabs API key and press Save.
The key is stored in that browser only (never in this repo), and every ElevenLabs call goes from the
page, because the board has no internet.

- **Hold to talk** (button or space bar): "play Travis picking", "stop", "faster", "tempo ninety",
  "chord A minor", "next", "how do I play F", "what chord am I playing", "twelve bar blues",
  "chords G, D, E minor, C", "clear the song". The same commands can be typed in the box below it.
- **Hands-free**: say "guitar" first. It records whenever a voice rises above the room, so it costs a
  speech-to-text call per attempt; the sensitivity slider sets how far above the room a voice must be.
- **Call out the next chord**: while a song plays, the next bar's chord is spoken a beat early.
- **Coach conversation (experimental)**: "Create coach" makes an ElevenLabs agent with tools for this
  page in your account; "Start conversation" talks to it. Needs a quiet spot or a headset.

Code: `servo-strummer/assets/voice.js` (what was said -> command), `eleven.js` (speech-to-text,
text-to-speech, microphone), `coach.js` (agent), and `POST /song` in `python/main.py`.
After pulling, restart the app on the board so it picks up `/song`.
