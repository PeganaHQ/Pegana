# Runbook — Oncall escalation paths

> First responder is always the operator (Rafael). This document is
> for the *future* second responder, OR for the current operator
> reading their own notes at 3am.

**Box layout** (checked against `docker-compose.yml` and `scripts/deploy.sh`):
log in as `deploy` (`ssh "$PEGANA_DEPLOY_SERVER"`, i.e. `deploy@<prod-host>`;
the real host is in the private `docs/ops/` runbook, never in this mirrored
file). The stack is checked out at `~/pegana`; run every `docker compose`
command from there. Compose services: `postgres`, `redis`, `indexer`,
`engine`, `dispatcher`, `api`, `protocol-indexer`, `mcp-ts`, `caddy`,
`prometheus`, `alertmanager`, `node-exporter`, `grafana`. There is no `bot`
service: the Telegram bot and hosted webhooks are retired.

Two rules that bite at 3am:
- `docker compose restart` does **not** reload `.env`. After any `.env`
  change, recreate from the laptop: `./scripts/deploy.sh --config-only --services '<svc>'`.
- Do not rebuild on the box by hand (`docker compose up -d --build`). Code
  changes and rollbacks go through `./scripts/deploy.sh`, which keeps the old
  containers serving while it builds, health-gates the swap and smoke-tests
  the result. See [`rollback.md`](rollback.md) §A.

## Channels (where alerts come from)

What actually exists as of 2026-10-21 (repo config plus the r1 audit of the box):

| Source | What it tells you | Where to look |
|---|---|---|
| External uptime probe | `api /healthz`, `api /readyz`, `mcp /health` or `www` failed 3 attempts in a row, seen from GitHub's runners | An open issue labelled `uptime` on the public `PeganaHQ/Pegana` repo, assigned to the operator (GitHub email / mobile push). Workflow: `.github/workflows/uptime-probe.yml`, every 10 min |
| Alertmanager → Telegram and/or Discord | Any rule in `ops/alerts/pegana.yml` fired (critical repeats every 1h, warning every 12h; a plain-text message with status, severity, alertname, service, summary, description and instance) | The Telegram chat behind `ALERTMANAGER_TELEGRAM_CHAT_ID` (bot token `ALERTMANAGER_TELEGRAM_BOT_TOKEN`), and/or the Discord channel behind `ALERTMANAGER_DISCORD_WEBHOOK_URL`. With neither set, alertmanager runs on a null receiver and `./scripts/deploy.sh` prints `ALERTMANAGER IS NOT DELIVERING ALERTS` |
| Prometheus (self-hosted, internal) | Current alert state even when delivery is broken | `ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && docker compose exec -T prometheus wget -qO- localhost:9090/api/v1/alerts'` |
| Grafana (self-hosted, internal) | Dashboards over the same Prometheus | SSH tunnel: `ssh -L 3000:127.0.0.1:3000 "$PEGANA_DEPLOY_SERVER"`, then http://localhost:3000 (dashboard "Pegana overview"). There is no public Grafana host |
| Sentry | An unhandled exception in indexer / engine / api / dispatcher, and the `pegana-pg-backup` cron monitor | sentry.io → project `pegana`. Treat as dark until the owner confirms a working DSN (the browser tunnel was returning 403 `ProjectId` on 2026-10-21) |
| `./scripts/deploy.sh` exit code | Smoke canary, health-gated recreate, every compose service has a running container | The deploy output |

The retired `bot` service is not a channel; its Telegram bot account is reused
by Alertmanager only (config rendered at start by
`ops/alertmanager/render-config.sh`).

### External uptime probe: what it does and does not cover

It is the only channel that does not run on the box, so it is the one that
notices "the box is gone". It needs no secret: the issue it opens is a normal
GitHub notification to its assignee (repo variable `UPTIME_PROBE_ASSIGNEE`,
default `lrafasouza`); GitHub may also email the failed scheduled run to
whoever last changed the workflow's schedule. Limits:

- GitHub's cron is best effort. Runs can start 5 to 30 minutes late under
  load, so detection is 10 minutes at best and sometimes much longer.
- GitHub disables a scheduled workflow in a public repo after 60 days without
  repository activity. The mirror sync PRs count as activity; if syncs stop,
  re-enable it under Actions → uptime-probe.
- It only runs on `PeganaHQ/Pegana` (the job is skipped in the private repo),
  so it starts working once the next mirror sync carries the file over.
- It sees reachability and readiness, not wrong data.

Owner, once (needs-owner): make sure GitHub notifications for
`PeganaHQ/Pegana` reach a device you look at (Settings → Notifications:
"Participating, @mentions and custom" by email and GitHub Mobile push on),
then run the workflow once by hand (Actions → uptime-probe → Run workflow)
and confirm a green run. For a faster, independent second opinion, a free
external monitor (UptimeRobot, Better Stack, healthchecks.io) on the same
four URLs with email alerts is still worth the 10 minutes.

## Triage decision tree

```
Got paged?
├── Was it the external uptime probe (an `uptime` issue on PeganaHQ/Pegana)?
│   ├── api /healthz or mcp /health failing → see "Box is down"
│   ├── only api /readyz failing       → box is up, data is not fresh:
│   │                                    `curl -s https://api.pegana.xyz/readyz`, then "Engine is silent"
│   ├── only www failing               → Vercel, not the box (vercel-root-404.md)
│   └── everything answers 200 now     → transient; the probe closes the issue itself
│
├── Was it Sentry?
│   ├── Spike in error rate (>10/min)  → see "Burst of errors"
│   └── New error type, low rate       → file an issue, fix during business hours
│
├── Was it an Alertmanager (Telegram / Discord) alert?
│   ├── PeganaBackup*                  → "Backups failing"
│   ├── PeganaEngineSilent / PeganaHeartbeatStopped → "Engine is silent"
│   ├── PeganaPythStale                → "Pyth degraded"
│   ├── PeganaJupiterRateLimited       → "Jupiter rate-limited"
│   ├── PeganaHyloSanityFailures       → "Hylo drift detected"
│   ├── PeganaWebhookDeadLetters       → "Webhook dead letters"
│   ├── PeganaAssetMiscalibrated       → "Asset miscalibrated"
│   └── PeganaScrapeTargetDown         → a service stopped exporting metrics;
│                                        start with "Box is down" step 2
│
├── Disk filling up? There is NO disk alert rule. Check `df -h /` by hand
│   (or the node-exporter filesystem metrics in Grafana) → "Disk pressure"
│
└── User said something is wrong?
    └── Reproduce first. If reproducible → file issue; if not → ask
        for screenshot, browser, timestamp.
```

## Playbooks

### Box is down (`/healthz` 5xx or timeout)

```bash
# 0. From the laptop: which layer is down?
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 10 https://api.pegana.xyz/healthz
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 10 https://mcp.pegana.xyz/health
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 10 https://www.pegana.xyz/   # Vercel, not the box

# 1. Can you SSH in?
ssh "$PEGANA_DEPLOY_SERVER"

# 2. If yes:
cd ~/pegana
docker compose ps --format "table {{.Service}}\t{{.State}}\t{{.Status}}"   # what's red or missing?
docker compose logs --since 5m caddy          # TLS / upstream errors (api, mcp are behind Caddy)
docker compose logs --since 5m api            # or the red service
df -h /                                       # a full disk breaks every service at once
uptime; free -m                               # load / memory pressure (2 vCPU box)

# 3. Start a stopped or missing service without rebuilding:
docker compose up -d <service>
#    Anything that needs new code or a reloaded .env goes through the laptop:
#    ./scripts/deploy.sh --config-only --services '<service>'

# If no SSH:
# Hostinger hPanel → VPS → browser terminal / recovery console → look at boot output
# Most likely: disk full (see "Disk pressure"). After a reboot, check
# `systemctl is-enabled docker` (must be "enabled") and `docker compose ps`.
```

### Engine is silent (`PeganaEngineSilent` / `PeganaHeartbeatStopped`, or `/readyz` not ready)

```bash
cd ~/pegana
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

### Pyth degraded (`PeganaPythStale`: `pegana_engine_pyth_stale_total` rate > 0.2/s for 30m)

Pyth Hermes is the upstream — there's not much we can do beyond
backoff. Check status.pyth.network first. If it's an outage on their
end, the engine's staleness gate (30s in `EngineState`) will start
dropping readings and `pyth_stale_total` will rise.

Acceptable user-facing impact: assets that derive intrinsic from
Pyth (BRZ, yield-bearing stables) will flip to `state=UNKNOWN`.
That's by design — better than reporting on stale data.

### Jupiter rate-limited (`PeganaJupiterRateLimited`: `pegana_jupiter_polls_total{status="error"}` > 0.1/s)

```bash
# Check the rate (on the box, in ~/pegana)
docker compose logs --since 5m indexer | grep -i jupiter | head -20
# If sustained: either Jupiter changed their keyless budget (verify
# at https://station.jup.ag/docs/) or our POLL_TICK_MS is too aggressive.
# Quick fix: bump POLL_TICK_MS in ~/pegana/.env from 2500 to 4000, then
# recreate the indexer FROM THE LAPTOP (a restart does not reload .env):
#   ./scripts/deploy.sh --config-only --services indexer
# Real fix: set JUPITER_API_KEY (and JUPITER_MAX_CONCURRENT) the same way.
```

### Hylo drift detected (`PeganaHyloSanityFailures`)

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

### Webhook dead letters (`PeganaWebhookDeadLetters`)

The Telegram bot is retired and hosted webhooks are not offered (webhook
fan-out in `dispatcher-rs` exists for self-hosting), so on the hosted box this
alert should never fire. If it does, something registered a subscriber:

```bash
cd ~/pegana
docker compose logs --since 30m dispatcher | grep -iE "dead.?letter|delivery" | head -20
```

Find out where the subscriber came from before touching anything; do not
delete rows on production without a written plan (see `docs/ops/`).

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

### Backups failing (`PeganaBackupLocalStale` / `PeganaBackupOffsiteStale` / `PeganaBackupLastRunFailed` / `PeganaBackupNotRunning`)

```bash
tail -40 ~/.pg-backup.log
cat ~/.pegana-metrics/pegana_backup.prom      # last_exit_code: 2 config, 3 dump/verify, 4 offsite, 5 disk
ls -lt ~/backups | head                        # verified local copies (kept even when R2 fails)
crontab -l | grep pg-backup                    # cron entry present?
docker compose ps node-exporter                # metrics reaching Prometheus?
```

- exit 4 with `AccessDenied ... 403`: the R2 token behind the `r2:` rclone
  remote cannot write the bucket. Owner issues an Object Read & Write token,
  then `rclone config` (edit remote `r2`) and re-run `./scripts/pg-backup.sh`.
- exit 5: free disk; local rotation keeps at most 10 dumps (4 recent + 6 more days), see "Disk pressure".
- Full procedure and restore drill: [`restore.md`](restore.md).

### Disk pressure (no alert rule; check `df -h /`, act above ~80%)

```bash
df -h
# Usual suspects: Docker build cache (deploy.sh prunes it), ~/backups, or
# Postgres WAL after a long-running write.

# Quick wins:
du -sh ~/backups ~/.pegana-metrics
docker system df                               # images / build cache / volumes
sudo du -sh /var/lib/docker/volumes/* | sort -h | tail
# Build cache is the usual winner; deploy.sh prunes it after each build. By hand:
docker builder prune -af
# Keep fewer local backups (the newest is always kept):
#   PEGANA_BACKUP_KEEP_RECENT=2 PEGANA_BACKUP_KEEP_DAILY=3 ~/pegana/scripts/pg-backup.sh

# If the Postgres volume is the culprit: migration 0059 set a 7-day
# compression policy on discount_snapshots. Check (read-only) that the policy
# job exists and is succeeding:
cd ~/pegana
docker compose exec -T postgres sh -c 'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT j.job_id, j.hypertable_name, s.last_run_status, s.last_successful_finish
FROM timescaledb_information.jobs j
JOIN timescaledb_information.job_stats s USING (job_id)
WHERE j.proc_name = 'policy_compression';
SQL
# No row, or a failing last_run_status, is the finding. Fixing it WRITES to
# production: only with a fresh verified backup and a written plan.
```

### Burst of errors (Sentry rate > 10/min)

```bash
# Identify the new error in Sentry (or the logs), then the service (on the box):
cd ~/pegana
docker compose logs --since 10m <service> | grep -i error | head -30

# Did it start with a deploy? What is deployed, and what was before it:
git rev-parse --short HEAD
git reflog -10 --date=iso        # each deploy is a reset/checkout entry
```

If it started with the last deploy, roll back with `scripts/deploy.sh` from
the laptop: [`rollback.md`](rollback.md) §A. Do not `git checkout` plus
`docker compose up -d --build` on the box: that skips the `PEGANA_GIT_SHA`
build arg and `--no-cache` (so receipts would carry the wrong
`methodology_git_sha`), the health-gated `--wait` recreate, the post-deploy
canary and the build-cache prune that keeps the disk from filling.

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

- Hostinger VPS: hPanel → VPS → support
- Cloudflare R2: dashboard → support
- Pyth Hermes status: https://status.pyth.network/
- Solana RPC status: https://status.solana.com/
