# V2 launch runbook — activating everything on `landing/v2-port`

> **2026-07-16.** Branch `landing/v2-port` (~242 commits ahead of `origin/main`; follow the branch tip at merge time, not a pinned SHA).
> **NOTHING here is live.** The whole V2 — V5 rebrand + `/lst` + market-cap +
> eHYUSD relabel + the 4 frontend wins + 4 product/backend items — sits on the
> preview branch. This is the ordered activation. **Steps flagged 🔒 are
> irreversible; order matters.** Every claim below is cross-checked against the
> code (file:line cited). Web deploys via Vercel on push to `main`; Rust services
> deploy via `scripts/deploy.sh` on `${PEGANA_DEPLOY_SERVER}`.

## 0 · Pre-flight (all green before starting)

- [ ] **Web gate:** `cd web && npx tsc --noEmit && npx vitest run` → tsc clean · **791 vitest green** (now incl. `oracle-degraded-badge`, **`intrinsic-degraded-badge`**, `lst-liveness/route`, `intrinsic-degraded` classifier, `glossary`).
- [ ] **Rust gate:** `cargo test --workspace` → **all green** (methodology + engine + api + indexer + xtask + pegana-replay). api-rs bin **81 tests**; indexer **90**; xtask **15**; pegana-replay **18+14**. ✅ **`cargo fmt --all --check` now CLEAN** (the earlier pre-existing drift was fixed in `00a7ab0` and kept green through the backend-upgrade batch — no longer a cleanup TODO).
- [ ] **Ops gate:** `promtool check rules ops/alerts/pegana.yml` (**25 rules** — was 23; +`PeganaLstDirectoryFlagged` +`PeganaStakePoolEpochLag`) + `promtool test rules ops/alerts/pegana_test.yml` → SUCCESS.
- [ ] **Backtest byte-exact:** the `2025-10-10-usde-depeg` replay reproduces at methodology 0.7.0 **identical** to 0.6.1 (the Pyth gate is provably inert until calibrated). ORACLE_DEGRADED is api-layer only (out-of-hash) → the golden is byte-exact regardless.
- [ ] **Branch synced:** `git rev-list --left-right --count origin/landing/v2-port...landing/v2-port` → `0 0`.
- [ ] **Founder secrets:** crates.io token (⚠️ **rotate the leaked one first**), Hetzner `${PEGANA_DEPLOY_SERVER}`, Vercel.

## 1 · 🔒 Publish crates to crates.io — **methodology FIRST, then CLI** (ADR-0030)

CLI-first-then-engine: a receipt the engine emits at methodology 0.7.0 must be verifiable by an **already-published** CLI. crates.io versions are **immutable** → publish before recreating the engine.
- ⚠️ Rotate the leaked crates.io token first.
- ⚠️ **ORDER MATTERS.** `pegana-replay 0.5.0` depends on `pegana-methodology 0.7.0` via a version pin (`crates/pegana-replay-cli/Cargo.toml:44`), and methodology is independently published (no `publish = false`). crates.io currently tops out at methodology **0.6.1**, so `cargo publish -p pegana-replay` is **rejected until 0.7.0 exists on the registry**. Publish methodology first:
  ```
  cargo publish -p pegana-methodology   # 0.7.0 — MUST be first
  cargo publish -p pegana-replay        # 0.5.0 — resolves methodology 0.7.0 from crates.io
  ```
- **Verify:** `cargo install pegana-replay` → verify a known receipt → **byte-exact PASS**.

## 2 · 🔒 Merge `landing/v2-port` → `main` = Vercel web deploy (**PROD**)

Single gate for everything visual/web: V5 rebrand + `/lst` + market-cap column + eHYUSD relabel + **the 4 wins** (asset-chart shaded bands, `/status/calibration` deep-dive, branded `/compare` share-card PNG, `/alerts`→`/events`) + X3 drift-guard + a11y route.
- ⚠️ `main` push = prod deploy (Vercel auto-builds **and** auto-promotes to www, ~1-2 min).
- ⚠️ Local `main` topology is divergent — never force; merge on `origin/main` via the normal FF flow (see the local-main-diverged note).
- **Verify:** computed token `--color-canvas #0a0a0b`; the 4 wins render; 0 console errors; nav compact-pill (`527747d`) — **founder eye: keep or revert**.

## 3 · Migrations 0064–0068 (`deploy.sh --migrate`)

Pending on the branch, not in prod:
- `migrations/0064_lst_coverage_expansion.sql` — **6 new-LST rows ONLY.** ✅ **dSOL reactivation was SPLIT OUT + deferred (Item 1, `c07fd47`)** — the `UPDATE` is gone, `assets.toml` keeps dSOL `active=false`, and its mint was removed from the web `jupiter-quote` allowlist in lockstep (`9e68950`). So `--migrate` no longer touches dSOL and there's **no dSOL frontend-split conflict** anymore. dSOL stays neutralized (matching prod/mig 0020) until the intrinsic-liveness GATE ships — NOT because the pool is unhealthy (it's alive: rate 1.20497 rising, validator voting) but because the frozen-backing detector doesn't exist in the verdict path yet. Reactivate WITH the gate (see the FOUNDER-GATED in-hash work). **No founder checkpoint needed here anymore** — the decision was already made (defer).
- `migrations/0065_asset_circulating_supply.sql` — market-cap columns (`ALTER TABLE assets ADD circulating_supply, supply_updated_at`, nullable, additive).
- `migrations/0066_methodology_v0_7_0.sql` — **data-only, no DDL**: INSERT/UPDATE the 0.7.0 row into `methodology_versions` (version registry, same pattern as 0044/0051/0062). The Pyth gate itself is a compile-time CONST (`thresholds.rs:166`), NOT DB-stored — see step 4.
- `migrations/0067_oracle_snapshots_feed_idx.sql` — index `oracle_snapshots(feed_id, publish_time DESC)` for the 3-leg oracle asof-join on `/history`. Additive, read-path only. ⚠️ hypertable → on the non-empty prod table apply with `WITH (timescaledb.transaction_per_chunk)` (same as 0052).
- `migrations/0068_intrinsic_liveness.sql` — the `intrinsic_liveness` table for the ADR-0038 gate (a plain table, `CREATE TABLE IF NOT EXISTS`, FK to `assets`). Additive; the indexer starts upserting into it (observe-only) after step 7, and the engine only READS it once `INTRINSIC_LIVENESS_GATE` is set (step 7.6). Safe to apply now.
- Run: `scripts/deploy.sh --migrate`.
- ⚠️ `--migrate` alone does NOT populate `/lst`: 0064's new LSTs read **"not yet rated"** until the engine+indexer recreate (steps 6-7) reloads `assets.toml` (the runtime source of truth, mounted `:ro`). See ROADMAP.md.

## 4 · Calibrate SQL vs prod (Pyth + depth) — **before** the engine recreate

- **Pyth confidence-gate:** ⚠️ `PYTH_CONFIDENCE_GATE_BPS = 500` is a **CONST**, `crates/methodology/src/thresholds.rs:166` — **NOT an env**. To change it = rebuild + version bump (ADR-0032). Run **Pyth Query B** (conf/price vs `oracle_snapshots`) to confirm 500bps is right first.
- **Depth gate GO/NO-GO:** run the depth SQL vs prod liquidity to decide the floor (ADR-0034/0026). The gate ships **disabled**.
- **ORACLE_DEGRADED thresholds (advisory, low-stakes):** run **ADR-0035 Queries A/B/C** (divergence / oracle-own-feed conf / staleness distributions) vs prod to confirm 75 / 100 / 90 rarely trip on healthy operation. These are api-side CONSTS (`crates/api-rs/src/oracle_degraded.rs`) → tuning = api rebuild, but **out-of-hash** (never moves a verdict), so it can be tuned post-launch without a methodology bump. Lower priority than the Pyth/depth gates.

## 5 · Set env `DEPTH_GATE_FLOOR_USD`

- Read at `crates/engine-rs/src/main.rs:154`; `0` = disabled (the shipped default). Set to the calibrated floor **only** after step 4's GO. `DEPTH_GATE_FLOOR_USD=0` is the tested kill-switch (`engine-rs/src/main.rs:1973`).

## 6 · 🔒 Recreate engine — methodology 0.7.0 + gates + synth_lev-B + latency

- ⚠️ **NEVER mid-calibration.** Dual-run/announce cadence per ADR-0025/0030.
- Picks up: Pyth conf-gate → UNKNOWN on wide reads (0.7.0, ADR-0032), depth-gate P1 (ADR-0034, disabled), synth_lev-B fix, latency instrumentation.
- **Verify:** verdicts identical to 0.6.1 with the gate inert; depth gate off.

## 7 · Deploy api + indexer (`deploy.sh --services 'api indexer'`)

- ⚠️ **`--services` is SPACE-separated + quoted** (`deploy.sh:10` header; `$SERVICES` is spliced UNQUOTED into `docker compose build/up` at `:133/:144`, so it word-splits on whitespace only). `--services api,indexer` (comma) = one bogus service name `api,indexer` → `no such service`, rebuilds NEITHER. Use `'api indexer'`.
- **api** — the rebuild carries: (1) market-cap `market_cap` field on `/v1/assets` (needs mig 0065); (2) **the `/v1/calibration` CORS fix** (`is_public_read_path`, `crates/api-rs/src/main.rs`) → makes `/status/calibration` + `/status` counts work cross-origin (they currently show "feed unreachable" everywhere but prod-same-origin); (3) **the 3-leg oracle leg** — `oracle_usd` on `/v1/assets/{symbol}/history` (asof-join, honest-gated on `market_kind`, needs mig 0067); (4) **ORACLE_DEGRADED** — additive `oracle_degraded` on the single-asset detail `/v1/assets/{symbol}` (+by-mint), OUT-OF-HASH advisory amber layer (ADR-0035; api-synth, no migration, reuses the mig-0067 index); (5) **the self-calibration metrics task** — exports `pegana_calibration_health_code{asset}` etc. on the api `/metrics` (`:9092`) for the `PeganaAssetMiscalibrated` alert (see the new Ops step below).
- **indexer** — market-cap `token_supply` source (reads SPL Mint supply, mig 0065).
- **Verify oracle_degraded:** `curl .../v1/assets/JUPUSD | jq .oracle_degraded` → present only when the independent oracle leg is degraded (usually null/omitted for healthy assets). Front badge on `/asset` (V5 amber, `st-drift`).
- **Verify CORS:** `curl -H "Origin: https://pegana.xyz" -D- https://api.pegana.xyz/v1/calibration | grep -i access-control-allow-origin` → header present. (Pre-fix: absent.)
- **Verify market-cap:** `/v1/assets` rows carry `market_cap`.

## 7.5 · Ops — Prometheus alert rules (self-calib alert) + Docker pins (AC72)

- **Self-calibration alert (ADR-0029 self-monitor → paging):** `ops/alerts/pegana.yml` gains the `pegana.calibration` group + `PeganaAssetMiscalibrated` (`pegana_calibration_health_code >= 2` for 30m, `severity: warning`, `service: api`). Deploy = update the mounted rules file (`/etc/prometheus/rules/pegana.yml`) + reload Prometheus: **`docker compose kill -s SIGHUP prometheus`** (run from `~/pegana` on the Hetzner box — the compose DNS name `prometheus:9090` does NOT resolve from the host SSH shell, so a `curl .../-/reload` from there fails). Depends on the api rebuild (step 7) exporting the metric on `:9092`. **Validate first:** `promtool check rules ops/alerts/pegana.yml` + `promtool test rules ops/alerts/pegana_test.yml` (both SUCCESS). Note the stale-gauge behaviour is handled in-code (a deactivated asset's gauge is reset to `-3`, below the `>= 2` threshold — `main.rs` calibration task).
- **Docker base-image pins (AC72):** all 12 `FROM` are pinned to `tag@sha256:<digest>`; `deploy.sh` builds pull the exact digests (no action — just confirm the build succeeds; the pinned digests were amd64-verified). `.github/dependabot.yml` (docker, monthly) will open digest-bump PRs going forward.

## 7.6 · Backend-upgrade batch (2026-07-17) — where each piece activates

All additive; everything below is **out-of-hash** (never changes a verdict or the receipt hash) EXCEPT the intrinsic-liveness gate, which is in-hash but **ships DISABLED** (so it too is inert + byte-exact until the env is set — see the last bullet). Ships across the SAME steps above — no extra deploy, just noting what rides along:

- **CLI (step 1):** `pegana-replay` now returns **ONCHAIN_INCOMPLETE (exit 5)** for a severe alert (Depeg/Critical/BlackSwan) whose `commit_status=not_applicable` — instead of a false green PASS — because on-chain commit is disabled in prod (`PEGANA_COMMIT_KEYPAIR` unset). State-aware `onchain_skip_is_ok` mirrors the engine's anchor policy (ADR-0033 exit-5 doc amended). `9461d88`.
- **Web (step 2):** **INTRINSIC_DEGRADED** amber "backing may be frozen" badge on `/asset` (ADR-0037) — frontend-only, reuses the `/lst` directory fetch via a same-origin `/api/lst-liveness` proxy → `flags{stale,deprecated,dead}`. Ships with the Vercel deploy, zero backend. `154830a`.
- **Indexer (step 7, `--services indexer`):** (1) **lst self-audit recalibrated** — the `pegana_intrinsic_divergence_bps` tolerance moved **75→300** (the 75 sat below the verified ~114-124 bps realizable-vs-booked redemption haircut → false page on every LST); (2) decodes the directory `flags{stale,deprecated,dead}`+`ratePrev` → `pegana_lst_directory_flagged{asset,flag}`; (3) **SplStakePool epoch-lag** (`pegana_spl_stake_pool_epoch_lag{symbol}`) — the frozen-backing detector for jitoSOL et al. the directory flag doesn't cover; (4) `pegana_sanctum_lst_errs_total{lst}`. `8b00458`, `c8a9380`.
- **Ops alerts (step 7.5, same SIGHUP reload):** `PeganaIntrinsicDivergence` threshold 75→300 + false "same stake pool" premise corrected; **NEW** `PeganaLstDirectoryFlagged` + `PeganaStakePoolEpochLag`; `PeganaHyloDown` DefiLlama false-premise fixed. Rule count **23→25**.
- **Backtest (pre-flight):** the xtask runner now fires `discount_sanity` too (was missing → runner CRITICAL vs engine UNKNOWN for a garbage-HIGH intrinsic) + optional `Tick.pyth_conf` replays the ADR-0032 conf gate; **golden byte-exact** (existing fixtures carry no conf/direction-sensitive asset). Plus a hyUSD CR hard-error guard. `1377cce`, `19caa13`.
- **🔒 Intrinsic-liveness gate — IN-HASH but DISABLED (ADR-0038, `59a0075`):** forces UNKNOWN on a frozen backing (the dSOL mode). Rides the **0.7.0 bundle** (step 1 — no version bump, founder call) + **migration 0068** (`intrinsic_liveness` table, add to step 3's `--migrate`) + the indexer rebuild (step 7 — `lst_directory_audit`/`spl_stake_pool`/`hylo`/`perena` start populating the table, observe-only). **Ships INERT:** `INTRINSIC_LIVENESS_GATE` unset → the engine never reads the signal, `intrinsic_stale` is omitted from the hash → verdicts + receipts byte-identical. The gate signal covers **4 intrinsic-source types** (updated 2026-07-18): sanctum_lst = `flags.stale AND rate==ratePrev` (corroborated — see the calibration note); SplStakePool + Hylo = `epoch_lag>=2`; **Perena/USD\* = `nav_accrual_stall`** (`d62aade`/`a3012f5` — a densely+continuously-observed 12h flat NAV window, calibrated off 21d prod). **Pre-calibrated (live 2026-07-17, ADR-0038 §Calibration):** the raw `flags.stale` false-positived on 1 tracked asset (sharkSOL, $141 dust, rate-ADVANCING); the corroboration already excludes it, so the signal should be **0 tracked-assets-stale on healthy operation**. **To ENABLE (a SEPARATE, later, deliberate step — NOT at merge):** (1) let the indexer populate `intrinsic_liveness` for a cycle; (2) re-run the cross-check with the corroborated signal — expect 0 healthy trips (+ SplStakePool/Hylo `epoch_lag` distributions from the gauges); (3) set env `INTRINSIC_LIVENESS_GATE=on` (+ optional `INTRINSIC_LIVENESS_FRESHNESS_SECS`, default 3600) via `deploy.sh --config-only --services engine`. Consider deactivating sharkSOL regardless (dust). ⚠️ **NEVER enable mid-calibration.** Rollback = unset the env (instant, no redeploy).

## 8 · e2e full on CI

The backend-provisioned CI job (auth/data/latency specs can't run against a live preview; the tight 6s timeouts false-fail on a cold preview). Includes the new `/status/calibration` axe route.

## Rollback

- **Web:** `vercel promote <previous-url> --scope lrafasouzas-projects`.
- **Engine / api / indexer:** redeploy the previous build via `deploy.sh`; recreate the engine off the prior methodology tag if verdicts move unexpectedly.
- **Migrations:** additive (0065 nullable columns; 0066 a version-registry row; 0064's dSOL row) — safe to leave in place on a service rollback. To un-ship dSOL specifically, re-run mig 0020's deactivation, not a full rollback.

## NOT in this ship (still open)

- accountSubscribe (deferred rearchitecture) · rename identity `sHYUSD` (DB risk, deferred) · **ADR-0007 launch-scorecard 07-31**.
- **Block C — now PARTLY in this ship** (all on `landing/v2-port`, activate per the steps above): ✅ 3-leg oracle-divergence (backfilled) · ✅ self-calib Prometheus alert (step 7.5) · ✅ AC72 Docker pins (step 7.5) · ✅ ORACLE_DEGRADED amber advisory (step 7, ADR-0035). **Still open (NOT built):** Sub-B venues (Phoenix/Switchboard) · **Sub-C Loop Intelligence — gated on ADR-0036** (anonymous-position data boundary; founder "repensar") · M10-ext (skipped — task_up alert re-introduces false-fires) · assets 0c/0d/0e · H12b · AC67 (needs devnet keypair) · AC70 (needs 3 green manual repro-build runs → promote).
- **Demand/ops:** outreach · tokens.xyz · Ernani/Gecko · rotate tokens · Jupiter key.
- 👁️ nav compact-pill (`527747d`) — founder eye.
