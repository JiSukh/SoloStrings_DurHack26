#!/usr/bin/env bash
# Runs bus.sh against fake gh/git that log their args, then asserts on the log.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
log=$tmp/log

for bin in gh git; do
  cat >"$tmp/$bin" <<EOF
#!/usr/bin/env bash
echo "$bin \$*" >>"$log"
[[ "\$*" == "api user --jq .login" ]] && echo "\${FAKE_LOGIN:-ShinKhantSoeMoe}"
[[ "\$1 \$2" == "issue view" ]] && echo "Some task"
true
EOF
  chmod +x "$tmp/$bin"
done
bus() { PATH="$tmp:$PATH" "$root/scripts/bus.sh" "$@"; }
fail() { echo "FAIL: $1"; cat "$log"; exit 1; }
has() { grep -qF -- "$1" "$log" || fail "expected: $1"; }

[[ $(FAKE_LOGIN=JiSukh bus whoami) == "director (JiSukh)" ]] || fail "director role"
[[ $(bus whoami) == "worker (ShinKhantSoeMoe)" ]] || fail "worker role"

bus claim 7
has "gh issue edit 7 --add-assignee @me --add-label in-progress --remove-label todo"
has "git switch -c ShinKhantSoeMoe/7 origin/main"

bus ask 7 "which db?"
has "gh issue edit 7 --add-label question"

bus pr 7
has "gh pr create --title Some task --body Closes #7"

FAKE_LOGIN=JiSukh bus task "T" "B"
has "gh issue create --title T --body B --label todo"
grep -q -- "--assignee" <(tail -1 "$log") && fail "no assignee flag when none given"

bus claim 2>/dev/null && fail "claim without N should exit non-zero"
echo "bus_test: ok"
