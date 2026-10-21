#!/usr/bin/env bash
# Hermetic tests for scripts/deploy.sh. Nothing is pushed or deployed:
# `git`, `ssh`, `cargo` and `curl` are stubs on PATH, and the remote script
# deploy.sh would send over ssh is captured and syntax-checked instead.
#
# Run: bash scripts/tests/deploy.test.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/deploy-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

pass=0; failed=0
check() { local desc="$1"; shift; if "$@"; then pass=$((pass+1)); printf '  ok   %s\n' "$desc"; else failed=$((failed+1)); printf '  FAIL %s\n' "$desc"; fi; }

mkdir -p "$WORK/bin"
cat > "$WORK/bin/git" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  rev-parse) [[ "${2:-}" == "--abbrev-ref" ]] && echo main || echo 0123456789abcdef0123456789abcdef01234567 ;;
  status) ;;            # clean tree
  push) echo "git push stub $*" >> "$STUB_DIR/git.log" ;;
  *) ;;
esac
STUB
cat > "$WORK/bin/ssh" <<'STUB'
#!/usr/bin/env bash
# Last non-option args: SERVER then the command. Capture stdin.
n=$(ls "$STUB_DIR"/ssh-*.in 2>/dev/null | wc -l | tr -d ' ')
cat > "$STUB_DIR/ssh-$n.in"
if [[ "$n" -eq 0 ]]; then exit "${STUB_REMOTE_RC:-0}"; fi
# the alertmanager delivery check
if grep -q 'proc/1/cmdline' "$STUB_DIR/ssh-$n.in"; then
  [[ "${STUB_AM:-}" == FAIL ]] && exit 255
  printf '%s\n' "${STUB_AM:-channels=telegram}"
  exit 0
fi
# the missing-services check
printf '%s' "${STUB_MISSING:-}"
STUB
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/bin/cargo"
printf '#!/usr/bin/env bash\necho 200\n' > "$WORK/bin/curl"
chmod +x "$WORK/bin/"*

run_deploy() {
  rm -f "$WORK"/ssh-*.in "$WORK/git.log"
  env PATH="$WORK/bin:$PATH" STUB_DIR="$WORK" PEGANA_DEPLOY_SERVER=deploy@example.invalid "$@" \
    bash "$SCRIPT" >"$WORK/out.log" 2>&1
}

echo "healthy deploy"
run_deploy; rc=$?
check "exit 0" test "$rc" -eq 0
check "remote script is valid bash" bash -n "$WORK/ssh-0.in"
check "recreate is health-gated (--wait)" grep -q -- "--force-recreate --wait --wait-timeout 180" "$WORK/ssh-0.in"
check "missing-service check ran" grep -q "comm -23" "$WORK/ssh-1.in"
check "no grafana.pegana.xyz URL printed" bash -c "! grep -q grafana.pegana.xyz '$WORK/out.log'"

echo "alertmanager delivery check"
check "delivery check ran" grep -q "proc/1/cmdline" "$WORK/ssh-2.in"
check "delivery check script is valid bash" bash -n "$WORK/ssh-2.in"
check "exec stdin is /dev/null" test "$(grep -c '</dev/null' "$WORK/ssh-2.in")" -eq 2
check "reports the channels" grep -q "alertmanager delivers to *telegram" "$WORK/out.log"
STUB_AM="channels=none" run_deploy; rc=$?
check "null receiver: still exit 0" test "$rc" -eq 0
check "null receiver: loud warning" grep -q "ALERTMANAGER IS NOT DELIVERING ALERTS" "$WORK/out.log"
check "null receiver: names both channels" grep -q "ALERTMANAGER_TELEGRAM_BOT_TOKEN + ALERTMANAGER_TELEGRAM_CHAT_ID" "$WORK/out.log"
STUB_AM="FAIL" run_deploy; rc=$?
check "ssh failure: still exit 0" test "$rc" -eq 0
check "ssh failure: says it could not read" grep -q "delivery channels: could not be read" "$WORK/out.log"

echo "service without a container"
STUB_MISSING="alertmanager" run_deploy; rc=$?
check "exit 1" test "$rc" -eq 1
check "names the missing service" grep -q "without a running container: alertmanager" "$WORK/out.log"

echo "metrics dir is created before the recreate"
run_deploy; rc=$?
check "mkdir -p of the metrics dir precedes compose up" bash -c "grep -n 'mkdir -p \"\$METRICS_DIR\"\|force-recreate --wait' '$WORK/ssh-0.in' | head -2 | head -1 | grep -q mkdir"

echo "ssh failure in the missing-service check"
STUB_MISSING="CHECK-FAILED" run_deploy; rc=$?
check "exit 1" test "$rc" -eq 1
check "says the check could not run" grep -q "could not check for missing compose services" "$WORK/out.log"
check "does not call it a missing service" bash -c "! grep -q 'without a running container: CHECK-FAILED' '$WORK/out.log'"

echo "remote failure"
STUB_REMOTE_RC=1 run_deploy; rc=$?
check "exit 1" test "$rc" -eq 1
check "explains recreate-vs-refusal" grep -q "health-gated recreate step" "$WORK/out.log"

echo "custom wait timeout"
PEGANA_DEPLOY_WAIT_TIMEOUT=300 run_deploy; rc=$?
check "timeout is passed through" grep -q -- "--wait-timeout 300" "$WORK/ssh-0.in"

echo
echo "deploy tests: $pass passed, $failed failed"
(( failed == 0 ))
