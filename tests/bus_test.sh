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
if [[ "\$1 \$2" == "issue list" && -n "\${FAKE_WATCH:-}" && "\$*" == *label:question* ]]; then
  echo "issue #5 [question] q @t1"
elif [[ "\$1 \$2" == "issue list" && -n "\${FAKE_WATCH:-}" ]]; then
  n=\$(( \$(cat "$tmp/n" 2>/dev/null || echo 0) + 1 )); echo \$n >"$tmp/n"
  cat "$tmp/issues.\$(( n < 2 ? n : 2 ))"
fi
[[ "\$1 \$2" == "pr list" && -n "\${FAKE_WATCH:-}" ]] && echo "pr #9 [] p @t1"
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

# watch: first tick reports everything, later ticks only what's new or changed
printf 'issue #1 [todo] a @t1\n' >"$tmp/issues.1"
printf 'issue #1 [todo] a @t1\nissue #2 [todo] b @t1\n' >"$tmp/issues.2"
out=$(PATH="$tmp:$PATH" FAKE_WATCH=1 BUS_POLL=0.1 timeout 1 "$root/scripts/bus.sh" watch || true)
[[ $out == $'issue #1 [todo] a @t1\npr #9 [] p @t1\nissue #2 [todo] b @t1' ]] || fail "watch output was: $out"

# director: woken by worker questions AND by tasks assigned to them (missed #14 before)
echo 0 >"$tmp/n"
out=$(PATH="$tmp:$PATH" FAKE_LOGIN=JiSukh FAKE_WATCH=1 BUS_POLL=0.1 timeout 1 "$root/scripts/bus.sh" watch || true)
grep -qF "issue #5 [question]" <<<"$out" || fail "director watch missed a question: $out"
grep -qF "issue #1 [todo]" <<<"$out" || fail "director watch missed an assigned task: $out"
echo "bus_test: ok"
