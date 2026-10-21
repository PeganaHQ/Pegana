#!/usr/bin/env bash
# Hermetic tests for ops/alertmanager/render-config.sh, the script the
# alertmanager container runs at start to pick Telegram / Discord / null.
#
# Runs the script with POSIX sh (as busybox would) against throwaway secret
# files. When an amtool binary is available (AMTOOL=/path/to/amtool, or amtool
# on PATH) every rendered config is also checked with `amtool check-config`
# and the Telegram template is rendered with `amtool template render`; without
# one those checks are skipped with a note (the container still validates with
# its own /bin/amtool at start).
#
# Run: AMTOOL=/path/to/amtool bash scripts/tests/alertmanager-render.test.sh
# AM_TEST_SH picks the shell that runs the script (default sh; dash is the
# closest local stand-in for busybox ash).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/ops/alertmanager/render-config.sh"
NULL_CONFIG="$ROOT/ops/alertmanager/config-null.yml"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/am-render-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

AMTOOL_BIN="${AMTOOL:-$(command -v amtool 2>/dev/null || true)}"
# The script must not find an amtool on its own when the test has none.
NO_AMTOOL="$WORK/no-amtool"

SH="${AM_TEST_SH:-sh}"
TOKEN='123456789:AAbbCC_dd-EEsecretTOKEN'
HOOK='https://discord.com/api/webhooks/1/secretHOOK'

pass=0; failed=0
ok()   { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad()  { failed=$((failed + 1)); printf '  FAIL %s\n' "$1"; }
check() { local desc="$1"; shift; if "$@"; then ok "$desc"; else bad "$desc"; fi; }

# case_dir NAME: fresh secrets dir + out dir. Files mimic what compose writes:
# the value plus a newline, or a lone newline when the .env key is unset.
case_dir() {
  local d="$WORK/$1"
  mkdir -p "$d/secrets"
  printf '\n' > "$d/secrets/alertmanager_telegram_bot_token"
  printf '\n' > "$d/secrets/alertmanager_discord_webhook_url"
  echo "$d"
}
set_token() { printf '%s\n' "$2" > "$1/secrets/alertmanager_telegram_bot_token"; }
set_hook()  { printf '%s\n' "$2" > "$1/secrets/alertmanager_discord_webhook_url"; }

# run DIR [VAR=value ...]: runs the script in a clean env; stdout -> DIR/out,
# stderr -> DIR/err, exit code -> DIR/rc.
run() {
  local d="$1"; shift
  env -i PATH="$PATH" AM_SECRETS_DIR="$d/secrets" AM_NULL_CONFIG="$NULL_CONFIG" \
    AMTOOL="${AMTOOL_BIN:-$NO_AMTOOL}" "$@" \
    "$SH" "$SCRIPT" "$d/rendered" >"$d/out" 2>"$d/err"
  echo $? > "$d/rc"
}
rc()       { cat "$1/rc"; }
chosen()   { head -1 "$1/out"; }
rendered() { echo "$1/rendered/alertmanager.yml"; }
no_secret_in_output() { ! grep -qE 'secretTOKEN|secretHOOK' "$1/out" "$1/err"; }
amcheck() {
  [[ -n "$AMTOOL_BIN" ]] || return 0
  "$AMTOOL_BIN" check-config "$1" >/dev/null 2>&1
}

[[ -n "$AMTOOL_BIN" ]] || echo "note: no amtool (set AMTOOL=...); amtool checks are skipped"

echo "nothing set -> null config"
D=$(case_dir none); run "$D"
check "exit 0" test "$(rc "$D")" = 0
check "chooses the null config" test "$(chosen "$D")" = "$NULL_CONFIG"
check "warns loudly" grep -q 'WARN: alertmanager config: no alert channel is configured' "$D/err"
check "says nothing is delivered" grep -q 'NOT delivered anywhere' "$D/err"
check "renders nothing" test ! -e "$(rendered "$D")"
check "null config passes amtool" amcheck "$NULL_CONFIG"

echo "secret files missing entirely -> null config"
D="$WORK/missing"; mkdir -p "$D/secrets"; run "$D" ALERTMANAGER_TELEGRAM_CHAT_ID=42
check "exit 0" test "$(rc "$D")" = 0
check "chooses the null config" test "$(chosen "$D")" = "$NULL_CONFIG"

echo "telegram token + ALERTMANAGER_TELEGRAM_CHAT_ID"
D=$(case_dir tg); set_token "$D" "$TOKEN"; run "$D" ALERTMANAGER_TELEGRAM_CHAT_ID=-1001234567890
R=$(rendered "$D")
check "exit 0" test "$(rc "$D")" = 0
check "chooses the rendered config" test "$(chosen "$D")" = "$R"
check "one stdout line" test "$(wc -l < "$D/out" | tr -d ' ')" = 1
check "telegram receiver present" grep -q 'telegram_configs:' "$R"
check "no discord receiver" bash -c "! grep -q discord_configs '$R'"
check "token by file, not inline" grep -q "bot_token_file: $D/secrets/alertmanager_telegram_bot_token" "$R"
check "token value never in the config" bash -c "! grep -q secretTOKEN '$D/rendered/'*"
check "chat id rendered" grep -qx '        chat_id: -1001234567890' "$R"
check "plain-text parse mode" grep -qx '        parse_mode: ""' "$R"
check "critical repeats every 1h" grep -qx '      repeat_interval: 1h' "$R"
check "warning (root) repeats every 12h" grep -qx '  repeat_interval: 12h' "$R"
check "inhibit rule kept" grep -q 'inhibit_rules:' "$R"
check "both receivers get telegram" test "$(grep -c 'telegram_configs:' "$R")" = 2
check "no secret printed" no_secret_in_output "$D"
check "logs the channel" grep -q 'delivering to: telegram' "$D/err"
check "rendered config passes amtool" amcheck "$R"
mode=$(stat -c %a "$R" 2>/dev/null || stat -f %Lp "$R")
check "rendered config is 0600" test "$mode" = 600

echo "chat id falls back to DOGFOOD_TELEGRAM_CHAT_ID"
D=$(case_dir tgfb); set_token "$D" "$TOKEN"; run "$D" DOGFOOD_TELEGRAM_CHAT_ID=1234567890
check "chooses the rendered config" test "$(chosen "$D")" = "$(rendered "$D")"
check "fallback chat id rendered" grep -qx '        chat_id: 1234567890' "$(rendered "$D")"
D=$(case_dir tgpref); set_token "$D" "$TOKEN"; run "$D" ALERTMANAGER_TELEGRAM_CHAT_ID=777 DOGFOOD_TELEGRAM_CHAT_ID=999
check "ALERTMANAGER_TELEGRAM_CHAT_ID wins over the fallback" grep -qx '        chat_id: 777' "$(rendered "$D")"

echo "telegram token set, chat id unset -> null config"
D=$(case_dir tgnochat); set_token "$D" "$TOKEN"; run "$D"
check "exit 0" test "$(rc "$D")" = 0
check "chooses the null config" test "$(chosen "$D")" = "$NULL_CONFIG"
check "names the missing chat id" grep -q 'ALERTMANAGER_TELEGRAM_CHAT_ID (and DOGFOOD_TELEGRAM_CHAT_ID) is empty' "$D/err"
check "no secret printed" no_secret_in_output "$D"

echo "chat id set, token unset -> null config"
D=$(case_dir tgnotoken); run "$D" ALERTMANAGER_TELEGRAM_CHAT_ID=42
check "chooses the null config" test "$(chosen "$D")" = "$NULL_CONFIG"
check "says why" grep -q 'chat id set but no bot token' "$D/err"

echo "bad inputs never reach the config"
D=$(case_dir badchat); set_token "$D" "$TOKEN"; run "$D" ALERTMANAGER_TELEGRAM_CHAT_ID='42; rm -rf /'
check "non-numeric chat id -> null" test "$(chosen "$D")" = "$NULL_CONFIG"
D=$(case_dir zerochat); set_token "$D" "$TOKEN"; run "$D" ALERTMANAGER_TELEGRAM_CHAT_ID=-0
check "zero chat id -> null" test "$(chosen "$D")" = "$NULL_CONFIG"
D=$(case_dir badtok); set_token "$D" 'not a token'; run "$D" ALERTMANAGER_TELEGRAM_CHAT_ID=42
check "malformed token -> null" test "$(chosen "$D")" = "$NULL_CONFIG"
check "malformed token warns" grep -q 'does not look like' "$D/err"

echo "discord only"
D=$(case_dir dc); set_hook "$D" "$HOOK"; run "$D"
R=$(rendered "$D")
check "chooses the rendered config" test "$(chosen "$D")" = "$R"
check "discord receiver present" test "$(grep -c 'discord_configs:' "$R")" = 2
check "no telegram receiver" bash -c "! grep -q telegram_configs '$R'"
check "webhook by file" grep -q "webhook_url_file: $D/secrets/alertmanager_discord_webhook_url" "$R"
check "no secret printed or rendered" bash -c "! grep -rq secretHOOK '$D/out' '$D/err' '$D/rendered'"
check "rendered config passes amtool" amcheck "$R"
D=$(case_dir dchttp); set_hook "$D" 'http://discord.example/x'; run "$D"
check "non-https webhook -> null" test "$(chosen "$D")" = "$NULL_CONFIG"
check "non-https webhook warns" grep -q 'not an https URL' "$D/err"

echo "telegram + discord -> both"
D=$(case_dir both); set_token "$D" "$TOKEN"; set_hook "$D" "$HOOK"; run "$D" ALERTMANAGER_TELEGRAM_CHAT_ID=42
R=$(rendered "$D")
check "chooses the rendered config" test "$(chosen "$D")" = "$R"
check "telegram on both receivers" test "$(grep -c 'telegram_configs:' "$R")" = 2
check "discord on both receivers" test "$(grep -c 'discord_configs:' "$R")" = 2
check "logs both channels" grep -q 'delivering to: telegram+discord' "$D/err"
check "rendered config passes amtool" amcheck "$R"
D=$(case_dir bothbadtg); set_token "$D" "$TOKEN"; set_hook "$D" "$HOOK"; run "$D"
check "telegram broken, discord ok -> discord only" bash -c "grep -q discord_configs '$(rendered "$D")' && ! grep -q telegram_configs '$(rendered "$D")'"

echo "amtool rejects the render -> null config"
D=$(case_dir amfail); set_token "$D" "$TOKEN"
printf '#!/bin/sh\nexit 1\n' > "$WORK/false-amtool"; chmod +x "$WORK/false-amtool"
env -i PATH="$PATH" AM_SECRETS_DIR="$D/secrets" AM_NULL_CONFIG="$NULL_CONFIG" AMTOOL="$WORK/false-amtool" \
  ALERTMANAGER_TELEGRAM_CHAT_ID=42 "$SH" "$SCRIPT" "$D/rendered" >"$D/out" 2>"$D/err"
check "exit 0" test "$?" = 0
check "chooses the null config" test "$(chosen "$D")" = "$NULL_CONFIG"
check "warns about the failed check" grep -q 'failed amtool check-config' "$D/err"

echo "unwritable out dir -> null config"
D=$(case_dir ro); set_token "$D" "$TOKEN"; mkdir -p "$D/ro"; chmod 0500 "$D/ro"
env -i PATH="$PATH" AM_SECRETS_DIR="$D/secrets" AM_NULL_CONFIG="$NULL_CONFIG" AMTOOL="$NO_AMTOOL" \
  ALERTMANAGER_TELEGRAM_CHAT_ID=42 "$SH" "$SCRIPT" "$D/ro/sub" >"$D/out" 2>"$D/err"
check "exit 0" test "$?" = 0
check "chooses the null config" test "$(chosen "$D")" = "$NULL_CONFIG"
chmod 0700 "$D/ro"

echo "no argument -> usage error (the entrypoint then falls back to null)"
env -i PATH="$PATH" "$SH" "$SCRIPT" >/dev/null 2>&1
check "exit 1" test "$?" = 1

if [[ -n "$AMTOOL_BIN" ]]; then
  echo "telegram message template (amtool template render)"
  D="$WORK/both"
  msg=$("$AMTOOL_BIN" template render --template.glob="$D/rendered/pegana.tmpl" \
    --template.text='{{ template "pegana.telegram.message" . }}' 2>&1)
  check "renders without error" test -n "$msg"
  check "starts with the status" bash -c "printf '%s' \"\$1\" | head -1 | grep -Eq '^(FIRING \\([0-9]+\\)|RESOLVED) '" _ "$msg"
  printf '%s\n' "$msg" | sed 's/^/      | /'
fi

echo
echo "alertmanager-render tests: $pass passed, $failed failed"
(( failed == 0 ))
