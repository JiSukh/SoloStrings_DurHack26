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
