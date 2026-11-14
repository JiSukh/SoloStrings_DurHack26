# hackathon

## Setup (each person, once)

```sh
gh auth login                     # your own GitHub account
gh repo clone JiSukh/hackathon && cd hackathon
claude                            # then say: "read CLAUDE.md and start"
```

In Claude Code, keep it polling the bus:
`/loop 5m run scripts/bus.sh inbox and act on anything new per CLAUDE.md`

How the Claudes coordinate is in [CLAUDE.md](CLAUDE.md). Tests: `scripts/test.sh`.
