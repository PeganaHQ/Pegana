#!/usr/bin/env bash
# Hermetic tests for scripts/env-cleanup.sh. Uses a throwaway HOME; never
# touches a real .env.
#
# Run: bash scripts/tests/env-cleanup.test.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/env-cleanup.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/env-cleanup-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

pass=0; failed=0
ok()   { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad()  { failed=$((failed + 1)); printf '  FAIL %s\n' "$1"; }
check() { local desc="$1"; shift; if "$@"; then ok "$desc"; else bad "$desc"; fi; }

new_home() {
  local h="$WORK/home-$1"
  mkdir -p "$h/pegana"
  cat > "$h/pegana/.env" <<'ENV'
# Pegana prod env
POSTGRES_PASSWORD=pw-secret-123
RUST_LOG=info,sqlx=warn,pegana=debug

ALERTMANAGER_TELEGRAM_BOT_TOKEN=tg-secret-456
ALERTMANAGER_TELEGRAM_CHAT_ID=-100123
ALERTMANAGER_DISCORD_WEBHOOK_URL=
BOT_TOKEN=bot-secret-789
DOGFOOD_TELEGRAM_CHAT_ID=42
SENTRY_DSN="https://k@o.ingest.sentry.io/1"
ENV
  chmod 0600 "$h/pegana/.env"
  echo "$h"
}
run() { local h="$1"; shift; env -i PATH="$PATH" HOME="$h" bash "$SCRIPT" "$@" >"$h/out.log" 2>&1; }

echo "dry run"
H=$(new_home dry)
before=$(cat "$H/pegana/.env")
run "$H"; rc=$?
check "exit 0" test "$rc" -eq 0
check "file unchanged" test "$(cat "$H/pegana/.env")" = "$before"
check "reports RUST_LOG change" grep -q "RUST_LOG: 'info,sqlx=warn,pegana=debug' -> 'info,sqlx=warn'" "$H/out.log"
check "never proposes removing alertmanager telegram keys" bash -c "! grep -q 'remove key: ALERTMANAGER_TELEGRAM_' '$H/out.log'"
check "no retired keys reported" grep -q 'no retired keys present' "$H/out.log"
check "mentions kept bot keys" grep -q 'kept (owner decision, see --drop-bot-keys): BOT_TOKEN DOGFOOD_TELEGRAM_CHAT_ID' "$H/out.log"
check "never prints a secret value" bash -c "! grep -qE 'secret-|-100123' '$H/out.log'"
check "no backup dir in dry run" test ! -e "$H/.pegana-env-backups"
check "no stray file in the checkout" test "$(ls -A "$H/pegana")" = ".env"

echo "apply"
H=$(new_home apply)
orig=$(cat "$H/pegana/.env")
run "$H" --apply; rc=$?
check "exit 0" test "$rc" -eq 0
check "RUST_LOG set to default" grep -qx 'RUST_LOG=info,sqlx=warn' "$H/pegana/.env"
check "alertmanager telegram token kept" grep -qx 'ALERTMANAGER_TELEGRAM_BOT_TOKEN=tg-secret-456' "$H/pegana/.env"
check "alertmanager telegram chat id kept" grep -qx 'ALERTMANAGER_TELEGRAM_CHAT_ID=-100123' "$H/pegana/.env"
check "bot keys kept by default" grep -q '^BOT_TOKEN=bot-secret-789$' "$H/pegana/.env"
check "other keys byte-identical" grep -qx 'SENTRY_DSN="https://k@o.ingest.sentry.io/1"' "$H/pegana/.env"
check "empty key kept" grep -qx 'ALERTMANAGER_DISCORD_WEBHOOK_URL=' "$H/pegana/.env"
check "comment kept" grep -qx '# Pegana prod env' "$H/pegana/.env"
check "order kept (POSTGRES before RUST_LOG)" test "$(grep -nE '^(POSTGRES_PASSWORD|RUST_LOG)=' "$H/pegana/.env" | cut -d: -f1 | tr '\n' ' ')" = "2 3 "
mode=$(stat -c %a "$H/pegana/.env" 2>/dev/null || stat -f %Lp "$H/pegana/.env")
check ".env stays 0600" test "$mode" = 600
b=$(ls "$H/.pegana-env-backups"/env.* 2>/dev/null | head -1)
check "backup written" test -n "$b"
check "backup is the original" test "$(cat "$b")" = "$orig"
bmode=$(stat -c %a "$b" 2>/dev/null || stat -f %Lp "$b")
check "backup is 0600" test "$bmode" = 600
check "no stray file in the checkout" test "$(ls -A "$H/pegana")" = ".env"
check "no staged leftovers" test "$(ls -A "$H/.pegana-env-backups" | grep -c staged)" -eq 0
check "prints the recreate command" grep -q "deploy.sh --config-only --services 'indexer engine dispatcher api'" "$H/out.log"

echo "idempotent"
run "$H" --apply; rc=$?
check "second run exit 0" test "$rc" -eq 0
check "second run: nothing to change" grep -q 'nothing to change' "$H/out.log"
check "second run: no new backup" test "$(ls "$H/.pegana-env-backups"/env.* | wc -l | tr -d ' ')" -eq 1

echo "--drop-bot-keys"
H=$(new_home bot)
run "$H" --apply --drop-bot-keys; rc=$?
check "exit 0" test "$rc" -eq 0
check "BOT_TOKEN gone" bash -c "! grep -q '^BOT_TOKEN=' '$H/pegana/.env'"
check "DOGFOOD_TELEGRAM_CHAT_ID gone (ALERTMANAGER_TELEGRAM_CHAT_ID is set)" bash -c "! grep -q '^DOGFOOD_TELEGRAM_CHAT_ID=' '$H/pegana/.env'"
check "POSTGRES_PASSWORD kept" grep -q '^POSTGRES_PASSWORD=' "$H/pegana/.env"
check "alertmanager telegram token kept" grep -qx 'ALERTMANAGER_TELEGRAM_BOT_TOKEN=tg-secret-456' "$H/pegana/.env"
check "alertmanager telegram chat id kept" grep -qx 'ALERTMANAGER_TELEGRAM_CHAT_ID=-100123' "$H/pegana/.env"

echo "--drop-bot-keys keeps the chat-id fallback"
for variant in unset empty; do
  H=$(new_home "fb-$variant")
  if [[ $variant == unset ]]; then
    sed -i.x '/^ALERTMANAGER_TELEGRAM_CHAT_ID=/d' "$H/pegana/.env"
  else
    sed -i.x 's/^ALERTMANAGER_TELEGRAM_CHAT_ID=.*/ALERTMANAGER_TELEGRAM_CHAT_ID=/' "$H/pegana/.env"
  fi
  rm -f "$H/pegana/.env.x"
  run "$H" --apply --drop-bot-keys; rc=$?
  check "$variant: exit 0" test "$rc" -eq 0
  check "$variant: DOGFOOD_TELEGRAM_CHAT_ID kept" grep -qx 'DOGFOOD_TELEGRAM_CHAT_ID=42' "$H/pegana/.env"
  check "$variant: says why" grep -q "kept: DOGFOOD_TELEGRAM_CHAT_ID (alertmanager's chat id fallback" "$H/out.log"
  check "$variant: BOT_TOKEN still gone" bash -c "! grep -q '^BOT_TOKEN=' '$H/pegana/.env'"
  check "$variant: alertmanager token kept" grep -q '^ALERTMANAGER_TELEGRAM_BOT_TOKEN=' "$H/pegana/.env"
done

echo "RUST_LOG already default"
H=$(new_home tgonly)
sed -i.x 's/^RUST_LOG=.*/RUST_LOG="info,sqlx=warn"/' "$H/pegana/.env" && rm -f "$H/pegana/.env.x"
before=$(cat "$H/pegana/.env")
run "$H" --apply; rc=$?
check "exit 0" test "$rc" -eq 0
check "quoted default RUST_LOG left untouched" grep -qx 'RUST_LOG="info,sqlx=warn"' "$H/pegana/.env"
check "nothing to change" grep -q 'nothing to change' "$H/out.log"
check "file unchanged" test "$(cat "$H/pegana/.env")" = "$before"
check "no backup written" test ! -e "$H/.pegana-env-backups"

echo "--drop-bot-keys, only bot keys to remove"
H=$(new_home botonly)
sed -i.x 's/^RUST_LOG=.*/RUST_LOG="info,sqlx=warn"/' "$H/pegana/.env" && rm -f "$H/pegana/.env.x"
run "$H" --apply --drop-bot-keys; rc=$?
check "exit 0" test "$rc" -eq 0
check "says no recreate needed" grep -q 'no recreate needed' "$H/out.log"

echo "errors"
H="$WORK/home-missing"; mkdir -p "$H"
run "$H"; rc=$?
check "missing .env exits 2" test "$rc" -eq 2
run "$H" --bogus; rc=$?
check "unknown option exits 1" test "$rc" -eq 1

echo
echo "env-cleanup tests: $pass passed, $failed failed"
(( failed == 0 ))
