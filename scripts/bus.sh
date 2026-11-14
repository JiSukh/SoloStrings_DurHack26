#!/usr/bin/env bash
# Team bus: GitHub issues + PRs are the message queue between our Claude sessions.
# Role comes from your gh login, so nobody configures anything.
set -euo pipefail

DIRECTOR=JiSukh
me=$(gh api user --jq .login)
cmd=${1:-inbox}
shift || true

need() { [[ $# -ge $1 ]] || { echo "usage: bus.sh $cmd $2" >&2; exit 2; }; }
fmt='.[] | "#\(.number)\t\([.assignees[].login] | join(",") | if . == "" then "-" else . end)\t\([.labels[].name] | join(","))\t\(.title)"'

case $cmd in
  whoami)
    [[ $me == "$DIRECTOR" ]] && echo "director ($me)" || echo "worker ($me)" ;;

  board) # every open task, who has it, its status
    gh issue list --state open --limit 100 --json number,title,assignees,labels --jq "$fmt" ;;

  inbox) # what needs MY attention right now
    if [[ $me == "$DIRECTOR" ]]; then
      echo "## Questions / blockers from workers"
      gh issue list --search "is:open label:question,blocked" --json number,title,assignees,labels --jq "$fmt"
      echo "## PRs waiting for test + merge"
      gh pr list --state open
      echo "## Unassigned tasks"
      gh issue list --search "is:open no:assignee" --json number,title,assignees,labels --jq "$fmt"
    else
      echo "## My tasks"
      gh issue list --assignee @me --state open --json number,title,assignees,labels --jq "$fmt"
      echo "## My PRs with changes requested"
      gh pr list --author @me --search "review:changes_requested"
    fi ;;

  watch) # one stdout line per new/changed inbox item; run under Claude Code's Monitor tool
    if [[ $me == "$DIRECTOR" ]]; then iq="is:open label:question,blocked"; pq="is:open"
    else iq="is:open assignee:@me"; pq="is:open author:@me"; fi
    # shortcut: updatedAt also changes on your own actions, so you may get woken by yourself; filter by actor if noisy
    prev=
    while :; do
      if cur=$( { gh issue list --search "$iq" --json number,title,labels,updatedAt \
                    --jq '.[] | "issue #\(.number) [\([.labels[].name] | join(","))] \(.title) @\(.updatedAt)"'
                  gh pr list --search "$pq" --json number,title,reviewDecision,updatedAt \
                    --jq '.[] | "pr #\(.number) [\(.reviewDecision)] \(.title) @\(.updatedAt)"'; } | sort ); then
        comm -13 <(echo "$prev") <(echo "$cur") | grep -v '^$' || true
        prev=$cur
      fi # on a network error keep the old snapshot and retry next tick
      sleep "${BUS_POLL:-15}"
    done ;;

  task) # director: task "title" "body" [assignee]
    need 2 '"title" "body" [github-login]' "$@"
    gh issue create --title "$1" --body "$2" --label todo ${3:+--assignee "$3"} ;;

  claim) # worker: claim N -> assign to me, mark in-progress, branch off main
    need 1 N "$@"
    gh issue edit "$1" --add-assignee @me --add-label in-progress --remove-label todo
    git fetch origin main
    git switch -c "$me/$1" origin/main ;;

  ask) # anyone: ask N "question" -> comment + flag for the director
    need 2 'N "question"' "$@"
    gh issue comment "$1" --body "❓ $2"
    gh issue edit "$1" --add-label question ;;

  answer) # director: answer N "reply" -> comment + clear the flag
    need 2 'N "reply"' "$@"
    gh issue comment "$1" --body "💬 $2"
    gh issue edit "$1" --remove-label question,blocked ;;

  pr) # worker: pr N -> push branch, open PR that closes issue N
    need 1 N "$@"
    git push -u origin HEAD
    gh pr create --title "$(gh issue view "$1" --json title --jq .title)" --body "Closes #$1"
    gh issue edit "$1" --add-label review --remove-label in-progress ;;

  *)
    echo "usage: bus.sh [whoami|board|inbox|watch|task|claim|ask|answer|pr]" >&2; exit 2 ;;
esac
