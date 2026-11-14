# Team protocol (read first, every session)

Three Claude Code sessions, one per person, work on this repo at the same time.
They never talk directly: **GitHub issues and PRs are the message bus.**
`scripts/bus.sh` wraps every bus action. Run `scripts/bus.sh whoami` to learn your role.

| GitHub login      | Person               | Role     |
|-------------------|----------------------|----------|
| `JiSukh`          | Jirawat              | director |
| `ShinKhantSoeMoe` | Shin Khant Soe Moe   | worker   |
| `RayNCL2023`      | Debanjan Ray         | worker   |

## Status labels (one per issue)

`todo` → `in-progress` → `review` → closed by merge. `question` / `blocked` = needs the director.

## If you are a WORKER

1. `scripts/bus.sh inbox`: see your tasks. Do nothing that is not in a task issue.
2. `scripts/bus.sh claim N`: assigns you and creates branch `<login>/N` off `origin/main`.
3. Work only in the files/area the issue names. Need to touch something outside it? `scripts/bus.sh ask N "..."` and wait.
4. Commit small. Before opening a PR, run `scripts/test.sh` and make it pass.
5. `scripts/bus.sh pr N`: pushes and opens a PR that closes issue N.
6. Stuck or unsure? `scripts/bus.sh ask N "question"`, then keep going on anything unblocked.
7. Never merge, never push to `main`, never edit another person's branch.

Stay in the loop: `/loop 5m run scripts/bus.sh inbox and act on anything new per CLAUDE.md`.

## If you are the DIRECTOR

- Split work into issues with a clear scope (which files/area) and acceptance criteria:
  `scripts/bus.sh task "title" "body" <login>`. Give workers disjoint areas so PRs don't conflict.
- `scripts/bus.sh inbox`: answer questions (`scripts/bus.sh answer N "..."`), review PRs.
- You own testing and miscellaneous work (CI, config, deps, docs, glue, merge conflicts).
  For each PR: `gh pr checkout N`, `scripts/test.sh`, add the missing tests, then
  `gh pr merge N --squash --delete-branch`. Request changes with `gh pr review N --request-changes -b "..."`.
- Run your own subagents in parallel for side work. Use `isolation: "worktree"` so they
  never touch your working tree; each one works on its own issue + branch and opens a PR like a worker.
- `/loop 5m run scripts/bus.sh inbox and act on anything new per CLAUDE.md`.

## Shared rules

- `scripts/test.sh` is the one test entry point (CI runs it on every PR). New test suites go in `tests/*_test.sh`, or add a line to `scripts/test.sh`.
- `main` must always pass `scripts/test.sh`.
- Decisions that affect everyone go in an issue comment, not in chat, so every Claude can read them.
