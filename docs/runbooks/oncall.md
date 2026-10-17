# Runbook — Oncall escalation paths

> First responder is always the operator (Rafael). This document is
> for the *future* second responder, OR for the current operator
> reading their own notes at 3am.

## Channels (where alerts come from)

| Source | What it tells you | Where to look |
|---|---|---|
| Sentry | An unhandled exception fired somewhere in indexer / engine / api / dispatcher / bot | sentry.io → project `pegana` |
| Grafana Cloud (Prometheus) | A metric crossed an alert threshold | grafana.com → dashboard "Pegana overview" |
| UptimeRobot | An external HTTP probe failed | uptimerobot.com → monitor `api.pegana.xyz/healthz` (backend) and `pegana.xyz` (Vercel-hosted frontend) |
| Telegram ops chat | Any of the above paged via the chat (planned: dedicated `@pegana_ops_bot`) | Private chat |
| Self-discovered (you noticed something) | n/a | Trust your instincts; the system is small enough |

All four channels currently route to the same human (you). When a
second person joins, split: Sentry+Grafana → engineer, UptimeRobot
→ frontline.

## Triage decision tree

```
Got paged?
├── Was it an UptimeRobot fail?
│   ├── /healthz returns non-200       → see "Box is down"
│   └── Site is up but UptimeRobot says no → check UptimeRobot ack; usually transient
│
├── Was it Sentry?
│   ├── Spike in error rate (>10/min)  → see "Burst of errors"
│   └── New error type, low rate       → file an issue, fix during business hours
│
├── Was it Grafana?
│   ├── engine_publishes == 0          → "Engine is silent"
│   ├── pyth_hermes_latency p95 > 30s  → "Pyth degraded"
│   ├── jupiter polls error rate > 0.1/s → "Jupiter rate-limited"
│   ├── hylo_sanity_failure_total > 0  → "Hylo drift detected"
│   ├── deliveries_total{status=failed} surge → "Dispatcher → bot broken"
│   ├── pegana_calibration_health_code >= 2 (30m) → "Asset miscalibrated"
│   └── disk_used > 80%                → "Disk pressure"
│
└── User said something is wrong?
    └── Reproduce first. If reproducible → file issue; if not → ask
        for screenshot, browser, timestamp.
```

## Playbooks

### Box is down (`/healthz` 5xx or timeout)

```bash
# 1. Can you SSH in?
ssh pegana@<server-ip>

# If yes:
docker compose ps              # what's red?
docker compose logs --since 5m # what's the latest error?

# If no SSH:
# Hetzner Cloud console → server → "VNC" tab → look at boot output
# Most likely: disk full (see "Disk pressure")
```

### Engine is silent (`engine_publishes == 0` for 1 minute)

```bash
docker compose logs --since 2m engine
# Common patterns:
#   - "reconnecting to redis" — Redis bounced; engine should self-heal in <30s
#   - panic / stack trace — usually a parse error on a new payload shape;
#     check recent indexer changes
#   - silence with no logs — process running but stuck. Restart it:
docker compose restart engine
docker compose logs -f engine
# If engine recovers, file a follow-up to figure out the wedge.
```

### Pyth degraded (`pyth_hermes_latency_seconds` p95 > 30s)

Pyth Hermes is the upstream — there's not much we can do beyond
backoff. Check status.pyth.network first. If it's an outage on their
end, the engine's staleness gate (30s in `EngineState`) will start
dropping readings and `pyth_stale_total` will rise.

Acceptable user-facing impact: assets that derive intrinsic from
Pyth (BRZ, yield-bearing stables) will flip to `state=UNKNOWN`.
That's by design — better than reporting on stale data.

### Jupiter rate-limited (`jupiter_polls_total{outcome="error"}` > 0.1/s)

```bash
# Check the rate
docker compose logs --since 5m indexer | grep -i jupiter | head -20
# If sustained: either Jupiter changed their keyless budget (verify
# at https://station.jup.ag/docs/) or our POLL_TICK_MS is too aggressive.
# Quick fix: bump POLL_TICK_MS in .env from 2500 to 4000, restart
# indexer. Real fix: get a Jupiter API key + set JUPITER_MAX_CONCURRENT.
```

### Hylo drift detected (`hylo_sanity_failure_total` > 0)

The check that fired tells you what to look at. From most to least urgent:

- `pool_exceeds_supply` — the PDA derivation is producing a token
  account that doesn't belong to the Stability Pool. Hylo likely
  upgraded the Stability Pool program. Audit `STABILITY_POOL_PROGRAM`
  and `POOL_AUTH_SEED` constants in `crates/indexer-rs/src/sources/hylo.rs`.
- `cr_out_of_band` — derived CR < 50% or > 500%. Almost always means
  a TVL number is wrong, not Hylo. Cross-check DefiLlama's
  `currentChainTvls.Solana` value against Hylo's own dashboard.
- `tvl_out_of_band` — DefiLlama returned a TVL outside `[$1M, $10B]`.
  Either DefiLlama is broken or Hylo's TVL really did move that
  dramatically. Look at the curl response directly.
- `hyusd_supply_zero` / `xsol_supply_zero` — the mint is reading 0
  supply via RPC. Either mint got migrated (rare — verify with
  `verify-assets`) or RPC returned a bad account.
- `shyusd_pool_empty` — Stability Pool exists but is unfunded. Could
  be transient (just-deployed) or could mean POOL_AUTH PDA is wrong.

### Dispatcher → bot broken (`deliveries_total{status="failed"}` surges)

```bash
docker compose logs --since 5m dispatcher | grep -i "delivery failed" | head -20
docker compose logs --since 5m bot       | grep -i "send failed"      | head -20

# Most common: Telegram returning 401/403 because the bot got
# kicked from a group, or 429 because we spiked. Both are recoverable
# without operator action — the dispatcher's backoff handles them.
# DLQ stores the failed deliveries; weekly cron retries them.

# If sustained: BOT_TOKEN may be invalid (revoked from BotFather).
# Verify with: curl https://api.telegram.org/bot<TOKEN>/getMe
```

### Asset miscalibrated (`PeganaAssetMiscalibrated` — `pegana_calibration_health_code{asset} >= 2` for 30m)

Observability-only — this reads the `/v1/calibration` self-monitor (an asset's trailing-8d p95 effective discount is beyond its OWN `depeg_bps` band, ADR-0029). It does NOT gate the verdict. Two causes:

```
# 1. Is the asset genuinely depegged? Check the live verdict FIRST.
curl -s https://api.pegana.xyz/v1/assets/<SYMBOL> | jq '{state,discount,state_reason}'
#    If state is DEPEG/CRITICAL and there's a real event → the alert is TRUE; follow the peg-event flow, not this.

# 2. Or are the asset's thresholds miscalibrated for its normal range?
curl -s https://api.pegana.xyz/v1/calibration | jq '.[] | select(.symbol=="<SYMBOL>")'
#    Cross-check pegana_calibration_p95_bps{asset=<SYMBOL>} against the asset's depeg_bps in assets.toml.
#    If p95 chronically exceeds depeg_bps on a HEALTHY asset → the band is too tight; recalibrate assets.toml
#    (thresholds) — this is a calibration task, not an incident.
```

Notes: `service: api` (the metric is exported by the api container on `:9092`, not the engine). Codes: ok=0/watch=1/miscalibrated=2/no_data=-1/na=-2/inactive=-3 (only `>=2` pages). A **recently-deactivated** asset can't stick this alert — the api task resets a dropped asset's gauge to `-3` (below the threshold) the next tick, so a lingering fire means a LIVE miscalibration, not a retired asset.

### Disk pressure (>80%)

```bash
df -h
# Usually: /backups grew unbounded (PEGANA_BACKUP_KEEP wasn't honored)
# or Postgres WAL is large after a long-running write.

# Quick wins:
sudo du -sh /backups /var/lib/docker/volumes/* | sort -h | tail
# Drop old backups:
find /backups -name 'pegana-*.sql.gz' -mtime +14 -delete

# If Postgres volume is the culprit, enable TimescaleDB compression on
# the discount_snapshots hypertable (was on the v1.5 backlog):
docker exec pegana-postgres-1 psql -U pegana -d pegana -c "
  SELECT compress_chunk(i) FROM show_chunks('discount_snapshots',
    older_than => INTERVAL '7 days') i;"
```

### Burst of errors (Sentry rate > 10/min)

```bash
# Identify the new error in Sentry, then look at the corresponding service:
docker compose logs --since 10m <service> | grep -i error | head -30

# If the burst started after a recent deploy:
cd /opt/pegana
git log --oneline -5
git checkout <last-good-sha>
docker compose up -d --build
# See deploy-day.md "Emergency rollback" for the full procedure.
```

## What to do AFTER an incident

1. **Write the timeline** in a private gist: what fired, when you
   noticed, what you did, when it recovered. Plain text, no
   formatting needed.
2. **File a follow-up issue** in the repo with the timeline + the
   change(s) needed so this doesn't happen again. Even "added a
   regression test" counts.
3. **Update this runbook** if you discovered a new failure shape
   that doesn't have a playbook here. Future-you (and future-second-
   responder) will thank present-you.

## Quick contacts

- Hetzner support: https://console.hetzner.cloud/ → top right → ?
- Cloudflare R2: dashboard → support
- Pyth Hermes status: https://status.pyth.network/
- Solana RPC status: https://status.solana.com/
- Telegram BotFather: t.me/BotFather (only useful for token issues)
