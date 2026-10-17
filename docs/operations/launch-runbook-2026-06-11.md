# Trust Layer v0.1.0 — launch runbook (2026-06-11)

> Operational playbook for the public launch. Owner on call: Rafael.
> Pair the runbook with the demo script
> ([`docs/launch/demo-script-2026-06-11.md`](../launch/demo-script-2026-06-11.md))
> and the pre-deploy notes
> ([`pre-deploy-notes-trust-layer.md`](./pre-deploy-notes-trust-layer.md)).

> **HARDENED 2026-05-29** with all gotchas surfaced during the early-deploy
> session (Trust Layer went live 3 days ahead of schedule per ADR-0005). See
> § Session learnings at the bottom for the bug list.

## 0. Window

- T-48h (2026-06-09): final ADR-0015 review. Confirm no late changes to the
  per-class verdict rule, override clause, or evidence window.
- T-24h (2026-06-10): calibration v1 verdict per **ADR-0015** (supersedes ADR-0001).
  Run `scripts/calibration-v1-queries.sql` against prod Postgres and paste the
  mechanical output into `docs/CALIBRATION-v1.md`.
- T-2h (2026-06-11): pre-deploy checklist below.
- T-0 (2026-06-11): flip `FEATURE_PUBLIC_ALERTS` false→true via `up -d --force-recreate`, push tweet.
- T+0..T+2h (2026-06-11): execute per-asset activation/deferral using
  `docs/operations/post-launch-asset-batch.md`; do not activate assets that
  fail the ADR-0015 class gate or critical-asset completeness gate.
  - **Phase-0 activation (JupUSD, JLP, EURC, dzSOL, vSOL):** owner override —
    activate all 5 despite zero calibration history (sources verified live
    2026-06-10, CALIBRATION-v1 § V8). They ship **monitoring-grade** with
    provisional thresholds. Use the validated step-by-step in
    **[`phase0-activation-2026-06-11.md`](phase0-activation-2026-06-11.md)**
    (assets.toml is a `:ro` mount → `--force-recreate engine indexer`, no rebuild;
    do it only AFTER the 23:59 UTC window close).
- T+24h: scorecard sanity check + decide whether to amplify or pause.

## 1. Pre-deploy checklist

All items must be checked off before the deploy step runs.

- [ ] **Webhook health (replaces AC78 standalone report)** — open
      https://grafana.pegana.xyz and verify, for any 24h window in the
      last 7d:
      - `pegana_deliveries_total{channel="webhook",status="failed"}` /
        `pegana_deliveries_total{channel="webhook",status="ok"}` < 1% (failure rate)
      - `webhook_deliveries.elapsed_ms` p99 from Postgres < 5s
        (`pegana_webhook_delivery_seconds` does not exist; see CALIBRATION-v1 V6)
      Screenshot the panel; attach to the launch tweet thread if green.
      Per [`docs/operations/ac78-webhook-dogfood-decision.md`](ac78-webhook-dogfood-decision.md).

- [ ] **Calibration v1 verdict** — read `docs/CALIBRATION-v1.md` and confirm
      the mechanical outcome per [ADR-0015]:
  - Class A (peg-watched, 14 assets): ≥80% (12/14) calibrated via hybrid
    criterion (≥3 transitions OR ≥10d clean data with p95 |bps| < drift).
  - Class B (yield-bearing, 7 assets): ≥80% (6/7) same hybrid.
  - Class C (xSOL): excluded, exhibited with `monitoring` badge.
  - 5 critical assets (USDC, USDT, USDe, USDS, jitoSOL) have complete data.
  - Override clause from ADR-0015 used? Must be documented in CALIBRATION-v1.md.

- [ ] **Methodology version** — `crates/methodology/Cargo.toml` reads `0.3.0`
      (0.1.0 → 0.2.0 spread deadband, ADR-0021; → 0.3.0 CR deadband, ADR-0023 —
      both under the ADR-0009 critical-bug exception during calibration)
      AND the DB seed in `methodology_versions` matches:
      ```bash
      ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana && docker compose exec -T postgres \
        sh -c "psql -U \$POSTGRES_USER \$POSTGRES_DB -c \"SELECT version, status FROM methodology_versions;\""'
      ```
      Expected: `0.3.0 | active`, with `0.1.0` + `0.2.0` `deprecated`. Migrations
      0041 (0.2.0), 0043 (locale en), 0044 (0.3.0) are already applied to prod.

- [ ] **Receipt hash determinism** — if any `alert_evidence` rows exist with
      `onchain_tx_sig IS NOT NULL`, replay 5 random ones:
      ```bash
      pegana-replay --alert-id <id>
      ```
      All should `PASS`. If zero evidence rows (calibration window was calm),
      mark this check `N/A` in CALIBRATION-v1.md and proceed.

- [ ] **On-chain wallet** — `pegana_commit_wallet_balance_sol` ≥ 0.05 SOL.
      Engine now uses 1h-backoff Sentry capture per PR #45, so low balance no
      longer floods Sentry quota. Per ADR-0004 + ADR-0005 the actual minimum
      depends on expected alert rate × 0.0001 SOL/commit. 0.05 covers ~500
      commits ≈ 6 weeks at historical rates.
      ```bash
      curl -sS https://api.mainnet-beta.solana.com -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["7PpoyumFQMmcWzhJxDYr6iPv1fjYN41KBTA8xKKzu7R9"]}' \
        | python3 -c "import sys,json;r=json.load(sys.stdin);print(f'{r[\"result\"][\"value\"]/1e9:.6f} SOL')"
      ```

- [ ] **Sentry** — open https://sentry.io and the `pegana-prod` project. Last
      24h has zero `pegana_audit_persist_failed_total > 0` or
      `pegana_receipt_hash_fallback_total > 0` events. Wallet CRITICAL events
      OK (throttled to 1/h).

- [ ] **Backups** — last R2 dump < 6h old:
      ```bash
      ssh ${PEGANA_DEPLOY_SERVER} 'cat ~/.pegana-last-backup.txt'
      ```
      And bucket listing:
      ```bash
      ssh ${PEGANA_DEPLOY_SERVER} '~/pegana/scripts/pg-restore.sh list | head -3'
      ```

- [ ] **Backup encryption key off-host** — `~/.pegana-backup-key` on Hetzner
      MUST exist (calibration-watch alerts if not). Operator MUST have a copy
      in 1Password / USB / password manager. Without it, encrypted backups are
      unrecoverable.

- [ ] **Rollback artifact ready** — verify the `pre-trust-layer-launch` tag
      exists on prod:
      ```bash
      ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana && git tag | grep pre-trust-layer-launch'
      ```
      If missing, cut it on the current HEAD (lightweight tag — `git tag -a`
      fails on Hetzner because user.email is not set):
      ```bash
      ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana && git tag -f pre-trust-layer-launch HEAD'
      ```

- [ ] **R2 lifecycle rule** — confirmed in Cloudflare dashboard
      (R2 → pegana-backups → Object Lifecycle Rules: "Delete objects after
      30 days" Enabled). API GET is AccessDenied due to token scope; visual
      confirmation only.

- [ ] **Restore drill** — run the sidecar restore path from
      [`docs/runbooks/restore.md`](../runbooks/restore.md), using an R2 backup
      rather than local `/backups`. Paste the timestamp, dump name, and smoke
      query output into `docs/runbooks/drill-log.md` if present, otherwise into
      the launch notes.

- [ ] **Sentry alert rules** — in Sentry UI, confirm alert rules exist and route
      to the operator for:
      - new issue in web/api/engine/indexer/dispatcher/bot
      - error rate spike
      - `pegana_audit_persist_failed_total`
      - `pegana_receipt_hash_fallback_total`
      - commit-wallet critical/low balance events

- [ ] **iPhone/Safari real-device pass** — on the production Vercel deployment,
      use a physical iPhone in Safari and verify:
      - `/`, `/assets`, `/dashboard`, `/events` load without horizontal scroll.
      - Open hamburger after scrolling down; menu stays attached to the viewport.
      - Close hamburger; there is exactly one visible X while the menu is open.
      - Bottom tab bar respects the home indicator safe area.
      - `/assets` controls and rows are not hidden by the bottom tab bar.
      Attach screenshots if any waiver is needed. Playwright/WebKit is a gate,
      but this manual pass catches Safari chrome/home-indicator behavior.

- [ ] **Grafana reachable** — https://grafana.pegana.xyz/login responds
      with Grafana HTML (not Vercel 404). If 404: probably DNS cache —
      `dig grafana.pegana.xyz @8.8.8.8` should return `<prod-host>`.

## 2. Deploy steps

```bash
# 1. SSH (per memory: ssh ${PEGANA_DEPLOY_SERVER})
ssh ${PEGANA_DEPLOY_SERVER}

# 2. Pull
cd ~/pegana
git fetch origin
git log --oneline origin/main -5    # confirm the expected commit
git checkout main && git pull --ff-only
chmod +x scripts/*.sh               # git resets +x on .sh sometimes

# 3. Migrations.
# ⚠️ The 'xtask' compose service does NOT exist. Apply migrations directly
# via psql. NEW migrations only (already-applied ones will error harmlessly):
docker compose cp migrations postgres:/tmp/migrations
for m in $(ls migrations/*.sql | sort); do
  basename=$(basename "$m")
  echo "Applying $basename..."
  docker compose exec -T postgres sh -c \
    "psql -U \$POSTGRES_USER \$POSTGRES_DB -v ON_ERROR_STOP=1 -f /tmp/migrations/$basename" \
    || echo "(may already be applied — verify manually if errors)"
done

# 4. Rebuild + restart the services that changed.
# ⚠️ `docker compose restart` does NOT reload .env. For env-only changes,
# use `up -d --force-recreate`. Build with --build only when Rust code changed:
GIT_SHA=$(git rev-parse HEAD)
docker compose build --build-arg PEGANA_GIT_SHA="$GIT_SHA" engine api dispatcher mcp-ts bot
docker compose up -d --force-recreate engine api dispatcher mcp-ts bot

# 5. Wait for /ready on each service
for svc in api engine dispatcher; do
  echo "=== $svc ==="
  docker compose exec -T $svc curl -s http://localhost:8080/ready || true
done

# 6. Flip the feature flag (env_file change — REQUIRES force-recreate).
# Verify .env on the host has FEATURE_PUBLIC_ALERTS=true. If not:
grep FEATURE_PUBLIC_ALERTS ~/pegana/.env
# Edit, then RECREATE (NOT restart) the services that read it:
sed -i.bak 's/^FEATURE_PUBLIC_ALERTS=false/FEATURE_PUBLIC_ALERTS=true/' ~/pegana/.env
docker compose up -d --force-recreate api dispatcher bot

# 7. Verify env actually loaded (always check after .env edits)
docker compose exec -T bot sh -c "env | grep FEATURE_PUBLIC_ALERTS"
# Expected: FEATURE_PUBLIC_ALERTS=true
```

## 3. Post-deploy smoke tests

Run from your laptop, not from the box.

```bash
# Marketing landing
curl -sI https://pegana.xyz | head -1               # expect: HTTP/2 200

# Trust strip endpoints
curl -s https://pegana.xyz/api/methodology | jq .   # version=0.1.0 status=active
curl -s https://api.pegana.xyz/v1/audit?limit=1 | jq '.[0] | {id, asset, methodology_version}'

# Receipt + replay bundle for the most recent alert (if any evidence rows exist)
ID=$(curl -s https://api.pegana.xyz/v1/audit?limit=1 | jq -r '.[0].id // empty')
if [[ -n "$ID" ]]; then
  curl -sI "https://api.pegana.xyz/v1/audit/$ID"            # expect: 200
  curl -sI "https://api.pegana.xyz/v1/audit/$ID/replay"     # expect: 200, application/json
  curl -sI "https://api.pegana.xyz/v1/audit/$ID/onchain"    # expect: 200 (if SAS committed) or 202
fi

# Methodology catalog
curl -s https://api.pegana.xyz/v1/methodology/current | jq .

# Grafana dashboard (manual: open in browser, login as admin, verify panels render)
open https://grafana.pegana.xyz
```

Any non-200 from a `200`-expected endpoint = halt the launch and consult
the rollback section below.

## 4. Rollback

Rollback is **per-service**, not full-stack. The Phase 0 calibration data
in Postgres is read-only and reversible; rolling back the engine to the
previous tag preserves the historical data and just stops emitting the
new metadata.

```bash
# On the box
cd ~/pegana
git checkout pre-trust-layer-launch    # tag cut in pre-deploy step

# Rebuild + recreate (matches deploy step 4)
GIT_SHA=$(git rev-parse HEAD)
docker compose build --build-arg PEGANA_GIT_SHA="$GIT_SHA" engine api dispatcher mcp-ts bot
docker compose up -d --force-recreate engine api dispatcher mcp-ts bot

# Flip the flag back via env_file + force-recreate
sed -i.bak 's/^FEATURE_PUBLIC_ALERTS=true/FEATURE_PUBLIC_ALERTS=false/' ~/pegana/.env
docker compose up -d --force-recreate api dispatcher bot

# Verify
curl -s https://pegana.xyz/api/methodology | jq '.status'   # likely "active" still
ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana && docker compose exec -T bot sh -c "env | grep FEATURE_PUBLIC_ALERTS"'
```

Do **not** roll back Postgres migrations during launch — they are
additive (new tables: `alert_evidence`, `methodology_versions`, etc.). The
public `/v1/audit/<id>` endpoint will simply return 202 for any alert
emitted under the rolled-back version because no evidence row was
written.

If a Postgres restore IS required (worst case), the restore path is
documented in [`reference_r2_backup`](../../README.md):

```bash
# On Hetzner — restore from R2-encrypted backup
~/pegana/scripts/pg-restore.sh list                    # newest first
~/pegana/scripts/pg-restore.sh restore <NAME> --into pegana_restore_test
# ⚠️ The restore script calls timescaledb_pre_restore/post_restore — DO
# NOT bypass; without it, our BLOCK TRUNCATE trigger from migration 0037
# segfaults Postgres into recovery mode (observed 2026-05-29).
```

If the rollback itself fails: bring the bot offline first
(`docker compose stop bot`) — quiet failure is preferable to noisy
incorrect alerts. Then page Rafael.

## 5. First-24h monitoring focus

Open the Grafana dashboard at **https://grafana.pegana.xyz/d/pegana-overview**
(admin login — password in 1Password). Pin these panels in order:

| Panel | What healthy looks like |
|---|---|
| **Engine publish rate** | > 0 sustained (alerts are flowing) |
| **Audit persist rate by outcome** | `failed` line at zero |
| **Audit persist latency p50/p95/p99** | p99 < 0.05s |
| **On-chain commit outcomes** | `ok` dominates, `rpc_error` < 5% |
| **Commit wallet balance (SOL)** | > 0.05 SOL — refill before 0.02 SOL |
| **Commit queue depth** | non-zero (permits available); 0 = saturated |
| **Methodology broken (startup refusals)** | 0 (any value > 0 is a launch-blocking incident) |
| **Receipt hash fallback (total)** | 0 (each increment = a dropped/delayed alert; receipt NOT committed, no on-chain sentinel) |
| **API rate-limited requests by route** | spikes ok on `/v1/assets`, < 1/s sustained on others |
| **Retractions dispatched by methodology version** | should be 0 during launch — any non-zero is unexpected |
| **WS clients** | climbing through the day (people are watching) |

Refresh interval: 30s. Keep the time range at "now-1h" during the launch
hour, then bump to "now-6h" once stable.

**Secondary monitoring** (no Grafana needed):
- Sentry: https://sentry.io → `pegana-prod` project → Issues
- Telegram bot daily summary at 09:00 UTC
- Telegram bot anomaly watcher every 5 min (silent unless problem)
- `tail -f ~/.pg-backup.log` on Hetzner for backup health

## 6. Sentry — expected noise vs real

Sentry project: `pegana-prod` (rafael@pegana.xyz).
DSN propagates via `SENTRY_DSN` in `.env` to all 6 services (api, engine,
dispatcher, indexer, bot, mcp-ts).

| Pattern | Meaning | Action |
|---|---|---|
| `Jupiter 429` in bursts | Lite-api budget; expected at peak hours | Watch only; auto-throttle handles it |
| `Pyth stale` once per slow NAV feed | Daily NAV publish cadence | Ignore single events; investigate if > 3/min sustained |
| `webhook delivery 4xx` | Subscriber misconfigured endpoint | Forward to subscriber via Telegram, do not alert |
| `pegana commit wallet CRITICAL: 0.XXXX SOL` | Wallet below 0.1 SOL | Refill if low; throttled to 1/h since PR #45 — no quota spam |
| **`pegana_audit_persist_failed_total > 0`** | Receipt row missing | **Real — investigate the trace immediately** |
| **`pegana_receipt_hash_fallback_total > 0`** | Hashing failed → receipt DROPPED (no sentinel), alert delayed to next tick | **Real — investigate the trace; alert possibly delayed, receipt NOT poisoned** |
| **`pegana_engine_methodology_broken_total > 0`** | Engine refused to start | **Real — methodology rollback required** |
| **on-chain commit `outcome="timeout"` > 10% for 30m** | Solana RPC degraded | Check Helius / public RPC health, possibly swap endpoint |

**Do NOT trigger Sentry test alerts during launch.** The pipeline is
already noisy; injected noise makes it harder to spot real issues.

**Recommended alert rules** (Sentry dashboard → Alerts → Create):
- New issue created with `level:error AND server_name:engine` → email immediate
- Quota threshold 80% reached → email
- Any issue assigned `priority:high` → email

## 7. Comms cadence

| Time | Channel | Action |
|---|---|---|
| T-2h | internal | Pre-deploy checklist green-lit in private notes |
| T-0 | Twitter, Farcaster | Variant B tweet (see demo script) + reply thread |
| T+30m | internal | First-pass Grafana sweep |
| T+2h | Twitter | Reply to first commenter using template in [`twitter-copy-launch.md`](../launch/twitter-copy-launch.md) |
| T+24h | internal | Scorecard sanity check (per [ADR-0007]); decide amplify vs pause |

## 8. Session learnings — gotchas surfaced during the early-deploy session (2026-05-29)

These bugs all bit during the live deploy and are encoded above. Read this
section if anything in the runbook above looks "wrong" — it's probably the
hardened version.

1. **`docker compose restart` does NOT reload `env_file: .env`.** Use
   `docker compose up -d --force-recreate <services>`. Verify post-recreate
   with `docker compose exec <svc> env | grep <VAR>`. Caught when the
   FEATURE_PUBLIC_ALERTS=true→false flip and SENTRY_DSN propagation both
   silently failed via `restart`.

2. **`xtask` compose service does not exist.** Migrations must be applied
   via direct `psql` per the loop in § 2 step 3. The original runbook line
   `docker compose run --rm xtask cargo run -p xtask -- migrate` will fail.

3. **`git tag -a` fails on Hetzner.** `Committer identity unknown` because
   the prod box has no `user.email`/`user.name` git config (intentional —
   no git commits should happen on prod). Use lightweight tags:
   `git tag -f <name> HEAD`. No `-a`, no `-m`.

4. **TimescaleDB + BLOCK TRUNCATE trigger = SEGFAULT during pg_restore.**
   Migration 0037 installs a trigger that blocks TRUNCATE on prod tables.
   When pg_restore tries to TRUNCATE hypertable chunks during restore, the
   interaction with TimescaleDB internals segfaults the Postgres backend
   process. Fix encoded in `pg-restore.sh`: calls `timescaledb_pre_restore()`
   before pg_restore and `timescaledb_post_restore()` after.

5. **`pg_restore -j N` (parallel) silently loses hypertable data.** TimescaleDB
   catalog FK ordering violated: parallel workers process `chunk_constraint`
   before `dimension_slice` is committed. All chunks restored empty. Fix:
   `-j 1` sequential. See timescale/timescaledb#1584, #7137.

6. **Cloudflare R2 new-account subdomain takes ~15 min to propagate TLS.**
   Brand new R2 buckets show `SSL_HANDSHAKE_FAILURE` from any S3 client
   for the first 10-20 minutes. Wait it out; not your config.

7. **aws-cli S3 `addressing_style` must be `path` for R2** (not virtual).
   R2's wildcard cert doesn't cover the `bucket.account.r2.cloudflarestorage.com`
   double-subdomain shape that virtual-hosted style produces.

8. **`docker compose exec` doesn't support `--env-file`** (only `run` / `up`).
   For PGPASSWORD in `pg-backup.sh` we use `-e PGPASSWORD=...` (visible via
   `ps auxe` to other users on box; deploy/root only here — accepted risk).

9. **macOS DNS cache (mDNSResponder) ignores TTL** for ~5-10 min even with
   TTL=60. After DNS changes for any *.pegana.xyz subdomain, expect
   `dig` to show new IP while `curl` still hits old IP. Flush with
   `sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder` OR
   add `/etc/hosts` override to bypass DNS entirely.

10. **Grafana cannot be hosted on Vercel** (stateful Go server). Self-hosted
    on Hetzner via Caddy reverse proxy. `grafana.pegana.xyz` A record points
    to `<prod-host>`. Setup encoded in `docker-compose.yml` + `Caddyfile`.

[ADR-0001]: ../adr/0001-calibration-v1-verdict-rule.md
[ADR-0002]: ../adr/0002-per-asset-activation-rule.md
[ADR-0004]: ../adr/0004-onchain-commit-policy.md
[ADR-0005]: ../adr/0005-early-evidence-rollout.md
[ADR-0007]: ../adr/0007-launch-outreach-scorecard.md
[ADR-0015]: ../adr/0015-calibration-v1-per-class-verdict.md
