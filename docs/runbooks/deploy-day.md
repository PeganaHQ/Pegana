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
| 2. SSH hardening | [ssh-hardening.md](ssh-hardening.md) | 15 min | key login works; an unauthenticated probe gets `Permission denied (publickey)` with no `password` method |
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

## Emergency rollback

If something breaks within minutes of the deploy and you can't diagnose,
redeploy the previous good commit with `scripts/deploy.sh` from the laptop.
The full procedure (finding the last-good SHA from the box's `git reflog`,
the rollback branch, what `deploy.sh` checks) is
[`rollback.md`](rollback.md) §A. Do not `git checkout` plus
`docker compose up -d --build` on the box.

The box is `deploy@<prod-host>` (`$PEGANA_DEPLOY_SERVER`) with the stack in
`~/pegana`. The Hetzner-era `pegana@<server-ip>` / `/opt/pegana` layout in
older notes no longer exists.

Schema is forward-compatible across the current migrations, so rolling back
the code normally never requires rolling back the DB. If a migration changed
semantics, follow [`rollback.md`](rollback.md) §B and [`restore.md`](restore.md).

---

## R1 backend fixes: production operations (fix/r1-backend)

The code for these ships with the branch, but each item below needs an
operator step on production. Do them in order, after the branch is merged
to `main` and deployed with `scripts/deploy.sh`. Nothing here is done by
the deploy itself unless stated.

### (a) Web SSR rate-limit token (`PEGANA_WEB_SSR_TOKEN`)

Without it the API keeps working, but the web app's server-side fetches
share the anonymous 60 req/min per-IP budget of Vercel's egress IPs.

```bash
# 1. Generate once, store in 1Password vault `pegana-prod-env`.
TOKEN=$(openssl rand -hex 32)          # 64 hex chars; the API rejects short tokens

# 2. API host: add to the stack .env (REMOTE_DIR, default ~/pegana).
ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && grep -q ^PEGANA_WEB_SSR_TOKEN= .env \
  || echo "PEGANA_WEB_SSR_TOKEN=<TOKEN>" >> .env'
#    (paste the value in place of <TOKEN>; leave
#     PEGANA_WEB_SSR_RATE_LIMIT_PER_MIN unset to keep the 3000 default)

# 3. Recreate only the api container so it reloads .env.
./scripts/deploy.sh --config-only --services api
#    expect the api log line: "web SSR rate-limit budget (PEGANA_WEB_SSR_TOKEN)" enabled=true

# 4. Vercel: same value, server-only (NOT NEXT_PUBLIC_), Production env.
cd web && vercel env add PEGANA_WEB_SSR_TOKEN production
#    then redeploy web (env changes apply only to new deployments).

# 5. Verify the API honors the token (expect 3000), and that anonymous is still 60.
curl -s -D - -o /dev/null -H "x-pegana-ssr-token: $TOKEN" \
  https://api.pegana.xyz/v1/assets | grep -i '^ratelimit-limit'   # 3000
curl -s -D - -o /dev/null https://api.pegana.xyz/v1/assets \
  | grep -i '^ratelimit-limit'                                     # 60
```

Then load a server-rendered page (e.g. `https://www.pegana.xyz/`) a few
times and confirm in the api logs / `pegana_api_rate_limited_total{route="web_ssr"}`
that SSR requests are counted under the SSR budget and no 429 reaches web.
Rollback: remove the line from both sides; the API falls back to per-IP.

### (b) Migration 0080 (methodology release dates)

0080 is a data backfill (`UPDATE methodology_versions SET released_at = ...`).
It applies **only** through the sanctioned migrator:

```bash
./scripts/deploy.sh --migrate
```

Never run it by hand with psql (prod uses the legacy ledger path inside
`deploy.sh`). Verify:

```bash
curl -s https://api.pegana.xyz/v1/methodology/current | jq -r .released_at
#   expect 2026-07-16T19:26:11.000Z   (methodology 0.7.0)
```

### (c) Findings 12 / 21 (needs owner): Pyth Hermes API key

Since the 2026-08 Pyth Core upgrade the public Hermes host returns 401
without a key. The indexer then logs `pyth: no Hermes API key for the
public host ... reading on-chain price accounts as the primary source`
and the 8 assets reported dark in findings 12 / 21 stay `UNKNOWN`
(`state_reason: stale_source`). Record their symbols before step 3:
`curl -s https://api.pegana.xyz/v1/assets | jq -r '.data[] | select(.state=="UNKNOWN") | .symbol'`.

1. Owner obtains a Pyth Hermes API key (account decision, not automatable).
2. Add `PYTH_HERMES_API_KEY=<key>` to the API host `.env`.
3. Recreate the indexer: `./scripts/deploy.sh --config-only --services indexer`.
4. Verify:
   ```bash
   ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && docker compose logs --since 5m indexer | grep -i pyth'
   #   expect no "no Hermes API key" line and no repeating "pyth stream error"
   curl -s https://api.pegana.xyz/v1/assets | jq -r '.data[] | select(.state=="UNKNOWN") | .symbol'
   #   after ~2 min, the 8 previously dark assets must no longer be listed
   ```

### (d) Finding 2 (needs prod op): protocol-indexer HF enumeration

Read-only diagnosis; decide the fix from the log line:

```bash
ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && docker compose logs --since 24h protocol-indexer \
  | grep -E "HELIUS_API_KEY not set|RPC quota exhausted"'
```

- `[kamino_hf] HELIUS_API_KEY not set` / `[jupiter_lend_hf] HELIUS_API_KEY not set`:
  the key is missing. Set `HELIUS_API_KEY` in `.env`, then
  `./scripts/deploy.sh --config-only --services protocol-indexer`.
- `[kamino_hf] RPC quota exhausted at <symbol> - aborting cycle` (or the
  `jupiter_lend_hf` equivalent): the key is present but the plan quota is
  spent. Owner decision: raise the Helius plan or lengthen
  `KAMINO_HF_POLL_MS` / `JUPITER_LEND_POLL_MS`.
- Neither line: the enumeration is healthy; close the finding.

---

## Don't do these on deploy day

- Don't flip `FEATURE_PUBLIC_ALERTS=true` until 14-day dogfood passes
- Don't push web changes to Vercel the same hour (one moving piece at
  a time — see [`vercel-root-404.md`](./vercel-root-404.md) for that
  workflow)
- Don't send any outreach emails until you've personally received an
  alert end-to-end (see `docs/outreach/README.md`)
- Don't tweet — wait until you've watched the box stay green for 24h
