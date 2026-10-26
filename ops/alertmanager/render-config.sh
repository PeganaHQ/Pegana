#!/bin/sh
# Pegana - render the Alertmanager config at container start.
#
# Runs inside prom/alertmanager (busybox sh, user nobody), called by the
# alertmanager entrypoint in docker-compose.yml. POSIX sh only.
#
# Usage: render-config.sh OUT_DIR
#
# Prints ONE line on stdout: the config file Alertmanager must load. Every
# message for humans goes to stderr. Exit 0 whenever a usable config path was
# printed (the rendered one, or the null config). The caller still falls back
# to the null config on a non-zero exit or empty output, so a broken render
# can never keep Alertmanager down.
#
# Channels (each one is optional; every channel that is set gets every alert):
#
#   Telegram  token: the file $AM_SECRETS_DIR/alertmanager_telegram_bot_token
#                    (compose writes it from ALERTMANAGER_TELEGRAM_BOT_TOKEN as
#                    a `configs:` entry; a lone newline means unset, so the token is never in the container
#                    env, in process args or in `docker inspect`). The rendered
#                    config only points at it with `bot_token_file`.
#             chat:  env ALERTMANAGER_TELEGRAM_CHAT_ID, falling back to
#                    DOGFOOD_TELEGRAM_CHAT_ID. Not a secret; rendered inline.
#   Discord   URL:   the file $AM_SECRETS_DIR/alertmanager_discord_webhook_url
#                    (from ALERTMANAGER_DISCORD_WEBHOOK_URL, same mechanism),
#                    read by Alertmanager through `webhook_url_file`.
#
# Dead-man switch (optional, independent of the two channels above):
#   Heartbeat URL:   the file $AM_SECRETS_DIR/alertmanager_deadman_url (from
#                    ALERTMANAGER_DEADMAN_URL, same mechanism), an https ping URL
#                    of an off-box heartbeat service (for example healthchecks.io).
#                    The always-firing `Watchdog` alert is POSTed there every 5
#                    minutes; when the pings stop (Prometheus, Alertmanager or
#                    the box is gone, or someone silenced everything), the
#                    service alerts the owner. Unset: Watchdog goes to a
#                    receiver with no integrations.
#
# No channel set, or the rendered file fails `amtool check-config`: a loud WARN
# on stderr and the null config (blackhole receiver). Secret values are never
# printed.
#
# Overridable for tests: AM_SECRETS_DIR (default /run/secrets), AM_NULL_CONFIG
# (default /etc/alertmanager/config-null.yml), AMTOOL (default: amtool on PATH,
# /bin/amtool in the image; validation is skipped with a WARN if absent).

set -u

OUT_DIR="${1:-}"
SECRETS_DIR="${AM_SECRETS_DIR:-/run/secrets}"
NULL_CONFIG="${AM_NULL_CONFIG:-/etc/alertmanager/config-null.yml}"
TG_TOKEN_FILE="$SECRETS_DIR/alertmanager_telegram_bot_token"
DISCORD_URL_FILE="$SECRETS_DIR/alertmanager_discord_webhook_url"
DEADMAN_URL_FILE="$SECRETS_DIR/alertmanager_deadman_url"

warn() { echo "WARN: alertmanager config: $*" >&2; }
info() { echo "alertmanager config: $*" >&2; }

use_null() {
  warn "$1"
  warn "alerts are NOT delivered anywhere (null receiver). Set ALERTMANAGER_TELEGRAM_BOT_TOKEN + ALERTMANAGER_TELEGRAM_CHAT_ID (or ALERTMANAGER_DISCORD_WEBHOOK_URL) in .env and recreate alertmanager."
  echo "$NULL_CONFIG"
  exit 0
}

# True when FILE is readable and holds something other than whitespace. Compose
# writes a lone newline when the .env variable is unset (see docker-compose.yml).
nonblank() { [ -r "$1" ] && [ -n "$(tr -d ' \t\r\n' < "$1")" ]; }

[ -n "$OUT_DIR" ] || { echo "usage: render-config.sh OUT_DIR" >&2; exit 1; }

# ── Telegram ────────────────────────────────────────────────────────────────
tg=false
chat_id="${ALERTMANAGER_TELEGRAM_CHAT_ID:-${DOGFOOD_TELEGRAM_CHAT_ID:-}}"
if [ -e "$TG_TOKEN_FILE" ] && [ ! -r "$TG_TOKEN_FILE" ]; then
  warn "telegram: the bot token file exists but is not readable; telegram disabled"
elif nonblank "$TG_TOKEN_FILE"; then
  if ! tr -d ' \t\r\n' < "$TG_TOKEN_FILE" | grep -Eq '^[0-9]+:[A-Za-z0-9_-]+$'; then
    warn "telegram: the bot token does not look like <digits>:<chars>; telegram disabled"
  elif [ -z "$chat_id" ]; then
    warn "telegram: token set but ALERTMANAGER_TELEGRAM_CHAT_ID (and DOGFOOD_TELEGRAM_CHAT_ID) is empty; telegram disabled"
  elif ! printf '%s' "$chat_id" | grep -Eq '^-?[0-9]+$' || [ "${chat_id#-}" = "0" ]; then
    warn "telegram: the chat id is not a non-zero integer; telegram disabled"
  else
    tg=true
  fi
elif [ -n "$chat_id" ]; then
  info "telegram: chat id set but no bot token; telegram disabled"
fi

# ── Discord ─────────────────────────────────────────────────────────────────
discord=false
if [ -e "$DISCORD_URL_FILE" ] && [ ! -r "$DISCORD_URL_FILE" ]; then
  warn "discord: the webhook URL file exists but is not readable; discord disabled"
elif nonblank "$DISCORD_URL_FILE"; then
  if ! tr -d ' \t\r\n' < "$DISCORD_URL_FILE" | grep -Eq '^https://[^[:space:]]+$'; then
    warn "discord: ALERTMANAGER_DISCORD_WEBHOOK_URL is not an https URL; discord disabled"
  else
    discord=true
  fi
fi

# ── Dead-man heartbeat ──────────────────────────────────────────────────────
deadman=false
if [ -e "$DEADMAN_URL_FILE" ] && [ ! -r "$DEADMAN_URL_FILE" ]; then
  warn "deadman: the heartbeat URL file exists but is not readable; heartbeat disabled"
elif nonblank "$DEADMAN_URL_FILE"; then
  if ! tr -d ' \t\r\n' < "$DEADMAN_URL_FILE" | grep -Eq '^https://[^[:space:]]+$'; then
    warn "deadman: ALERTMANAGER_DEADMAN_URL is not an https URL; heartbeat disabled"
  else
    deadman=true
  fi
fi
if ! $deadman; then
  info "deadman: no heartbeat URL; the off-box dead-man switch is OFF"
fi

if ! $tg && ! $discord; then
  use_null "no alert channel is configured"
fi

# ── Render ──────────────────────────────────────────────────────────────────
umask 077
mkdir -p "$OUT_DIR" || use_null "cannot create $OUT_DIR"
out="$OUT_DIR/alertmanager.yml"
tmp="$out.tmp.$$"

# One receiver block. $1 = severity label shown in the text.
receiver_configs() {
  if $tg; then
    cat <<EOF
    telegram_configs:
      - bot_token_file: $TG_TOKEN_FILE
        chat_id: $chat_id
        send_resolved: true
        # Plain text: no HTML/Markdown parsing, so '<', '&', '_' or '*' in a
        # description can never make Telegram reject the message.
        parse_mode: ""
        message: '{{ template "pegana.telegram.message" . }}'
EOF
  fi
  if $discord; then
    cat <<EOF
    discord_configs:
      - webhook_url_file: $DISCORD_URL_FILE
        send_resolved: true
        username: Pegana alerts
        title: '[$1 {{ .Status | toUpper }}] {{ .CommonLabels.alertname }} ({{ .CommonLabels.service }})'
EOF
  fi
}

channels=""
$tg && channels="telegram"
$discord && channels="${channels:+$channels+}discord"

{
  cat <<EOF
# Rendered at container start by ops/alertmanager/render-config.sh.
# Channels: $channels. Do not edit; edit the render script.

global:
  resolve_timeout: 5m

templates:
  - $OUT_DIR/pegana.tmpl

route:
  receiver: pegana-warning
  group_by: ['alertname', 'service']
  group_wait: 30s
  group_interval: 5m
  # Warnings repeat twice a day: owner-blocked ones (silence them, see the
  # r3 runbook) would otherwise nag every few hours.
  repeat_interval: 12h
  routes:
    # Always-firing Watchdog: heartbeat only, never a human page.
    - matchers:
        - alertname = Watchdog
      receiver: pegana-deadman
      group_wait: 0s
      group_interval: 1m
      repeat_interval: 5m
    # Critical: faster first notification, repeats every hour while firing.
    - matchers:
        - severity = critical
      receiver: pegana-critical
      group_wait: 10s
      repeat_interval: 1h

receivers:
  - name: pegana-critical
EOF
  receiver_configs CRITICAL
  echo "  - name: pegana-warning"
  receiver_configs warning
  echo "  - name: pegana-deadman"
  if $deadman; then
    cat <<EOF
    webhook_configs:
      - url_file: $DEADMAN_URL_FILE
        send_resolved: false
EOF
  fi
  cat <<'EOF'

inhibit_rules:
  # While a critical for a service is firing, suppress its warnings: the
  # page already has on-call's attention; the warnings are just noise.
  - source_matchers:
      - severity = critical
    target_matchers:
      - severity = warning
    equal: ['alertname', 'service']
EOF
} > "$tmp" || use_null "cannot write $tmp"

# Plain-text Telegram message. Go text/template, no escaping needed because
# parse_mode is empty. Example:
#   FIRING (2) critical: EngineDown [engine]
#   - Engine is down @ engine:9100
#     No scrape for 2m.
cat > "$OUT_DIR/pegana.tmpl" <<'EOF' || use_null "cannot write $OUT_DIR/pegana.tmpl"
{{ define "pegana.telegram.message" -}}
{{ if eq .Status "firing" }}FIRING ({{ .Alerts.Firing | len }}){{ else }}RESOLVED{{ end }} {{ .CommonLabels.severity }}: {{ .CommonLabels.alertname }}{{ if .CommonLabels.service }} [{{ .CommonLabels.service }}]{{ end }}
{{ range .Alerts -}}
- {{ if eq .Status "resolved" }}(resolved) {{ end }}{{ if .Annotations.summary }}{{ .Annotations.summary }}{{ else }}{{ .Labels.alertname }}{{ end }}{{ if .Labels.instance }} @ {{ .Labels.instance }}{{ end }}
{{- if .Annotations.description }}
  {{ .Annotations.description }}
{{- end }}
{{ end -}}
{{- end }}
EOF

mv -f "$tmp" "$out" || use_null "cannot move the rendered config into place"

amtool_bin="${AMTOOL:-$(command -v amtool 2>/dev/null || echo /bin/amtool)}"
if [ -x "$amtool_bin" ]; then
  if ! "$amtool_bin" check-config "$out" >/dev/null 2>&1; then
    use_null "the rendered config failed amtool check-config"
  fi
else
  warn "amtool not found; the rendered config was not pre-validated"
fi

info "delivering to: $channels"
echo "$out"
