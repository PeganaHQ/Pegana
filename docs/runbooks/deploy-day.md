# Runbook — Deploy day (Hetzner first launch)

> One operator, one screen, one window. ~2.5 hours start to finish if
> nothing surprises. Pre-flight at the top is what kills the surprises.
> The actual provisioning commands live in
> [`docs/ops/deploy-hetzner.md`](../ops/deploy-hetzner.md) — this file
> is the checklist that wraps it.

---

## Pre-flight (≤ 30 min, before touching Hetzner)

Every box must be ✅ before SSH'ing into a new VPS.

### Code & repo

- [ ] `git status` clean on `main` (or the branch you'll deploy from)
- [ ] `git rev-list --count origin/main..main` returns `0` — nothing
      unpushed
- [ ] `cargo check --workspace --all-targets` green
- [ ] `cd bot-ts && bunx tsc --noEmit` green
- [ ] `cd web && pnpm typecheck` green
- [ ] `cargo xtask verify-assets` green (24/24 mints verified)
- [ ] No `TODO`/`FIXME` you'd be ashamed of:
      `grep -rE "TODO|FIXME" crates/ bot-ts/src/ | grep -v "// removed"`

### Secrets (in 1Password vault `pegana-prod-env`)

- [ ] `BOT_TOKEN` — from BotFather, 46 chars
- [ ] `BOT_INTERNAL_SECRET` — `openssl rand -hex 32`, ≥ 32 chars
- [ ] `DOGFOOD_TELEGRAM_CHAT_ID` — your own chat ID via @userinfobot
- [ ] `POSTGRES_PASSWORD` — strong, not the dev one
- [ ] `SENTRY_DSN` — per-service or per-project from sentry.io
- [ ] `FEATURE_PUBLIC_ALERTS=false` — stays false for 14-day dogfood
- [ ] R2 access key + secret for backups (if running Step 6 same day)

### External resources

- [ ] Hetzner Cloud account active, payment method on file
- [ ] Cloudflare account active, `pegana.xyz` zone present, nameservers
      already pointing at Cloudflare
- [ ] Cloudflare R2 bucket `pegana-backups` created (for Step 6) — or
      defer Step 6 to day 2

### Bot dogfood smoke (local)

These must all pass on `prod-local` docker stack before deploying:

- [ ] `/start` returns welcome + private-beta banner
- [ ] `/subscribe jitoSOL 0.5` then `/list` shows the row
- [ ] `/threshold jitoSOL 0.3` then `/list` shows the new threshold
- [ ] `/mute jitoSOL 4` then `/list` shows the 🔇 hint
- [ ] `/status` returns the 23-asset monospace table
- [ ] `/explain hyUSD` returns the per-asset HTML drill-down
- [ ] Synthetic alert via dispatcher reaches Telegram chat in < 5s

If anything in the dogfood smoke is red, fix locally before
provisioning.

---

## Deploy window (≤ 2 h, follow ops/deploy-hetzner.md in order)

Times below are estimates for a focused operator with no surprises.

| Step | Doc section | Time | Definition of done |
|---|---|---|---|
| 1. Provision VPS + DNS | §1 | 15 min | `dig api.pegana.xyz @1.1.1.1` returns the Hetzner IP; `dig www.pegana.xyz` resolves to Vercel |
| 2. SSH hardening | §2 | 15 min | `ssh pegana@ip 'sudo -n true'` works; root login blocked |
| 3. Docker install | §3 | 10 min | `docker compose version` works as `pegana` user |
| 4. Clone + env | §4 | 10 min | `grep -E '^(...)' .env` shows every required key |
| 5. First boot | §5 | 30 min | All 7 services `running` or `healthy` in `docker compose ps` |
| 6. Postgres backup wiring | §6 | 20 min | First `backup.sh` run lands in `/backups` + R2 |
| 7. Restore drill | §7 | — | **defer to day 2** unless you have spare time |
| 8. Observability | §8 | 30 min | Sentry shows 4 services; Grafana Agent (or scrape) running; **Prometheus alert rules loaded** — `promtool check rules ops/alerts/pegana.yml` passes and Prometheus `/api/v1/rules` lists the current alerts (incl. `PeganaAssetMiscalibrated`, exported by api `:9092` — see oncall.md). Reload after any `ops/alerts/*.yml` change: `docker compose kill -s SIGHUP prometheus` (from `~/pegana`; the compose DNS `prometheus:9090` isn't reachable from the host shell) |

If any step blows past 2× the estimate, **stop and diagnose**.
Don't push through.

---

## Smoke checklist (post-deploy, from your laptop)

Run these in order. Any failure = stop and fix before announcing
anything.

```bash
# 1. HTTPS + Caddy auto-cert (backend lives at api.* in v1.1)
curl -sIL https://api.pegana.xyz/healthz | grep -E '^HTTP|^content-type'
#   expect HTTP/2 200 and application/json

# 2. Backend up
curl -s https://api.pegana.xyz/healthz
#   expect {"status":"ok","uptime_secs":N}

# 3. Backend readiness (db + redis + engine has fresh snapshots)
curl -s https://api.pegana.xyz/readyz
#   expect 200 with db:true, redis:true, last_snapshot_age_secs<120
#   if 503, engine is still warming — wait 60s and retry

# 4. Live data flowing
curl -s https://api.pegana.xyz/v1/stats | python3 -m json.tool
#   expect assets_tracked > 0 and a recent timestamp

# 5. Asset endpoint
curl -s https://api.pegana.xyz/v1/assets/jitoSOL | python3 -m json.tool
#   expect state=PEGGED (or DRIFT/etc.), recent updated_at

# 6. WS upgrade works through Caddy
which wscat || npm i -g wscat
wscat -c wss://api.pegana.xyz/v1/ws
#   send: {"op":"subscribe","assets":["jitoSOL"]}
#   expect a snapshot frame within 2s, then heartbeats every 5s

# 7. Frontend served from Vercel + RSS feed
curl -sI https://www.pegana.xyz/feed/events.xml | grep -E '^HTTP|content-type'
#   expect 200 and application/rss+xml
curl -sI https://pegana.xyz | grep -E '^HTTP|^x-vercel'
#   expect 200 and an x-vercel-* header confirming Vercel terminus

# 8. Bot dispatcher → telegram pipe (only with dogfood enabled)
# This requires manually injecting a synthetic alert; documented in
# docs/ops/enable-bot-pipeline.md
```

If all 8 are green: **you are deployed.** Next: start the 14-day
dogfood window (see Epic 11 in ROADMAP.md) and ping @PeganaWatchBot's
`/status` daily for the next two weeks to confirm thresholds.

---

## Emergency rollback (≤ 10 min)

If something breaks within minutes of the deploy and you can't
diagnose:

```bash
ssh pegana@<server-ip>
cd /opt/pegana

# 1. Find the previous green deploy
git log --oneline -10

# 2. Revert to it
git checkout <last-known-good-sha>

# 3. Rebuild + redeploy
docker compose up -d --build

# 4. Verify
docker compose ps
curl -s https://api.pegana.xyz/healthz
```

Schema is forward-compatible across all current migrations, so
rolling back the code never requires rolling back the DB. **If you
ran a destructive migration manually outside `docker compose run
xtask migrate`, you're on your own — restore from `/backups/` per
ops/deploy-hetzner.md §7.**

---

## Don't do these on deploy day

- Don't flip `FEATURE_PUBLIC_ALERTS=true` until 14-day dogfood passes
- Don't push web changes to Vercel the same hour (one moving piece at
  a time — see [`vercel-root-404.md`](./vercel-root-404.md) for that
  workflow)
- Don't send any outreach emails until you've personally received an
  alert end-to-end (see `docs/outreach/README.md`)
- Don't tweet — wait until you've watched the box stay green for 24h
