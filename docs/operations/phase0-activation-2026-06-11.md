# Phase-0 activation — 2026-06-11 (launch day)

> Prepared 2026-06-10 (verdict day) alongside `docs/CALIBRATION-v1.md`.
> Activates the 5 Phase-0 assets **JupUSD, JLP, EURC, dzSOL, vSOL** at public launch.
> Owner decision (2026-06-10): activate all 5 despite zero calibration history.
> Companion to `launch-runbook-2026-06-11.md` § T+0..T+2h per-asset activation.

## Why this is a deliberate, eyes-open override

These 5 were `active = false` the entire calibration window, so the indexer
**skipped them** — they have **zero calibration data** (0 `discount_snapshots`,
not even rows in the DB `assets` table). They cannot carry a calibration verdict
on day 1. They are activated as **monitoring-grade** with **provisional
thresholds**, to be tuned after ≥7 days of live data (calibration retro).

**Their live data sources were verified functional on 2026-06-10** (CALIBRATION-v1
§ Senior validation V8): Pyth feeds fresh (<7s), Jupiter markets tradable with
~0% price impact (deep pools — SOL=$64.12 → dzSOL 1.053 SOL, vSOL 1.156 SOL, normal
LST premiums; EURC $1.155 tradable, NOT the BRZ `TOKEN_NOT_TRADABLE` failure),
Sanctum lists dzSOL+vSOL. So activation will **not** alert-storm on missing/garbage
data. The residual risks are: unvalidated thresholds, Jupiter free-tier 429 pressure
(+4 jupiter_usd slots), and no Pyth cross-check for dzSOL/vSOL (single-source LSTs).

## Mechanism (validated)

`assets.toml` is a **read-only volume mount** into both engine and indexer
(`docker-compose.yml`: `./assets.toml:/app/assets.toml:ro`), parsed **at process
startup** (`crates/indexer-rs/src/config.rs:89`). So activation needs **only a
`--force-recreate` of engine + indexer — NO image rebuild** (assets.toml is not
baked). The indexer's inactive-skip lives at `crates/indexer-rs/src/state.rs:56`.

The Postgres `assets` catalog must also contain rows for the five assets because
the snapshot hypertables enforce FKs to `assets(symbol)`. Migration
`0047_phase0_activation.sql` materializes those rows and keeps BRZ + pbUSDC
inactive. Run/apply that migration before recreating engine + indexer.

⚠️ Do this **only after the calibration window closes (2026-06-10 23:59 UTC)** — it
recreates the indexer, which is forbidden mid-window. Launch is 06-11, so this is safe.

## Provisional thresholds (already in assets.toml — unchanged, just unverified)

| Asset | class | drift / depeg / critical | intrinsic | market | Pyth conf? |
|---|---|---|---|---|---|
| JupUSD | stable_dn | 25 / 100 / 300 bps | fixed_1_usd | jupiter_usd | ✅ JUPUSD/USD |
| JLP | stable_yield | 200 / 500 / 1500 bps | pyth RR JLP/USD.RR | pyth_spot JLP/USD | ✅ (RR + spot) |
| EURC | stable_fx | 20 / 75 / 250 bps | pyth_fx EUR/USD | jupiter_usd | ✅ EURC/USD |
| dzSOL | lst | 50 / 120 / 280 bps | sanctum_lst | jupiter_usd | ❌ none |
| vSOL | lst | 55 / 140 / 300 bps | sanctum_lst | jupiter_usd | ❌ none |

## Steps (run on the box at T+0..T+2h, 2026-06-11)

```bash
ssh ${PEGANA_DEPLOY_SERVER}
cd ~/pegana
git fetch origin && git checkout main && git pull --ff-only   # gets the verdict commit 23c3e4f

# 1. Flip active=false -> active=true for ONLY these 5 (NOT BRZ, NOT pbUSDC).
#    Edit assets.toml by hand or with the per-asset anchored sed below.
#    Each block's `active = false` sits a few lines under `symbol = "<X>"`.
for sym in JupUSD JLP EURC dzSOL vSOL; do
  # flip the FIRST `active = false` after the matching `symbol = "<sym>"` line
  awk -v s="$sym" '
    $0 ~ "symbol +=" && $0 ~ "\""s"\"" {insec=1}
    insec && /active *= *false/ {sub(/active *= *false/,"active         = true"); insec=0}
    {print}
  ' assets.toml > /tmp/assets.toml.new && mv /tmp/assets.toml.new assets.toml
done

# 2. Verify exactly the intended 5 flipped.
#    BRZ + pbUSDC must STAY false; all other false rows are an error.
grep -nE "symbol|active *= *(true|false)" assets.toml | grep -B1 "active" | grep -A1 -E "JupUSD|JLP|EURC|dzSOL|vSOL|BRZ|pbUSDC"
grep -c "active         = false" assets.toml   # expect: BRZ + pbUSDC = 2 remaining

# 3. Recreate engine + indexer ONLY (mount-based; no --build needed for assets.toml).
#    If Rust code also changed this deploy, build first per the main runbook.
docker compose up -d --force-recreate engine indexer

# 4. Confirm both came back healthy + re-read the file:
docker compose ps engine indexer
docker compose logs --tail=40 indexer | grep -i "skipped .* inactive"   # should now skip 2 (BRZ,pbUSDC), not 7
```

## Verification (within ~5 min of recreate)

```bash
# The 5 should start producing snapshots + an engine state row:
docker exec -i pegana-postgres-1 psql -U pegana -d pegana -c "
  SELECT asset, count(*) AS snaps, max(ts) AS newest
  FROM discount_snapshots
  WHERE asset IN ('JupUSD','JLP','EURC','dzSOL','vSOL') AND ts > now() - interval '10 min'
  GROUP BY asset ORDER BY asset;"

docker exec -i pegana-postgres-1 psql -U pegana -d pegana -c "
  SELECT asset, last_state, ewma_discount, updated_at
  FROM engine_state_snapshot
  WHERE asset IN ('JupUSD','JLP','EURC','dzSOL','vSOL') ORDER BY asset;"
```

**Healthy =** each of the 5 has fresh snapshots and `last_state` in {PEGGED, DRIFT}
with a small `ewma_discount` (≪ their drift band). **Investigate if** any shows
`UNKNOWN` for >10 min (source not resolving) or a large `ewma_discount` (mispricing,
like the sHYUSD red flag — would mean the provisional thresholds or a source is off).

## Watch (first 48h)

- `pegana_engine_source_stale_total` on Grafana — should stay flat. A climb after
  activation = the +4 jupiter_usd slots tipped the free-tier 429 budget; if so,
  raise `jupiter_tick_ms` or drop a non-critical jupiter asset's cadence.
- The 5 assets' state on `/dashboard` — they carry **no calibration verdict**;
  exhibit as monitoring-grade until the post-launch tune.

## Rollback (if any of the 5 misbehaves)

```bash
# Re-disable just the offending asset(s): flip its active back to false, recreate.
# (same awk as step 1 with sub(/true/,/false/)), then:
docker compose up -d --force-recreate engine indexer
```

Deactivating is always safe — the asset drops out of the indexer/engine on the next
recreate, and its historical snapshots remain for the eventual real calibration.

## Post-launch (≥7 days later)

Run a calibration retro for the 5 (same `scripts/calibration-v1-queries.sql` scoped
to their activation window), then set verified thresholds (p95 × 1.25) and add a
proper per-asset ADR-0002 note. Until then they are explicitly monitoring-grade.
