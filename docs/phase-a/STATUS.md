# Phase A — Final status (2026-05-22)

> Asset universe expanded 18 → 30 monitored assets · 6 new Pyth/RR routes ·
> 1 Token-2022 adapter · 1 vault PDA adapter · 1 deferred (USD+) · 1 escalated (USD*)

## Operational state

### What's live on prod-local (`docker-compose.yml + .local.yml`)

```
verify-assets: 29 checked / 1 skipped (USD* deferred) / 0 failed
assets table:  30 rows on both DBs (:5433 dev + :5434 prod-local)
intrinsic_snapshots: 22 assets writing fresh data within 5min windows
```

Every Phase A asset has its mint pinned in the DB via:
- `migrations/0007_seed_phase_a_yield_bearing.sql` (12 rows inserted)
- `migrations/0008_piggybank_pbusdc_mint.sql` (pbUSDC mint resolved)

### Adapter coverage

| Asset | Mint | Adapter | Source channel | NAV today |
|---|---|---|---|---|
| `vSOL` | `vSoLx...kei7` | Sanctum batch | `pegana:src:sanctum` | live |
| `compassSOL` | `Comp4...zMU1h` | Sanctum batch | `pegana:src:sanctum` | live |
| `BNSOL` | `BNso1...X85` | Sanctum batch | `pegana:src:sanctum` | live |
| `picoSOL` | `picob...HYdX` | Sanctum batch | `pegana:src:sanctum` | live |
| `hSOL` | `he1iu...tn9A` | Sanctum batch | `pegana:src:sanctum` | live |
| `USDY` | `A1KLo...Eto6` | `pyth_redemption_rate` (USDY/USD.RR) | `pegana:src:pyth` | live |
| `sUSDe` | `Eh6XE...N2sN` | `pyth_redemption_rate` (SUSDE/USDE.RR) | `pegana:src:pyth` | live |
| `syrupUSDC` | `AvZZF...ZeUj` | `pyth_redemption_rate` (SYRUPUSDC/USDC.RR) | `pegana:src:pyth` | live |
| `ONyc` | `5Y8NV...xp5` | `pyth_redemption_rate` (NAV.ONYC/USD) | `pegana:src:pyth` | live |
| `sUSD` | `susda...iq4X` | `solayer_susd` (Token-2022 InterestBearing) | `pegana:src:solayer` | NAV=1.1345 (~25% APY) |
| `pbUSDC` | `F35yY...dMZR` | `piggybank_pb` (vault PDA, PBKTOKEN discriminator) | `pegana:src:piggybank` | NAV=1.1129 (~21% APY × 7m) |

### Deferred to v1.5

- **USD\*** — confirmed to be a Save Finance (Solend rebrand) cToken, NOT a
  Perena LP token as initially assumed. Decode requires Save's custom fork
  IDL which isn't public. Pyth `USD*/USD.RR` feed exists but no publishers.
  Inline research notes preserved in `assets.toml`.
- **USD+** — Streamflow's stablecoin not yet on mainnet (announced 2025-12-24,
  waitlist still open).

## Code surface (1.5k LoC added)

```
crates/common/src/lib.rs               +71  (8 IntrinsicStrategy variants, channels, polling fields, test assertion)
crates/indexer-rs/src/sources/pyth.rs  +226 (redemption-rate routing, asset-keyed envelope)
crates/indexer-rs/src/sources/solayer_susd.rs   NEW  205 lines
crates/indexer-rs/src/sources/piggybank_pb.rs   NEW  378 lines
crates/engine-rs/src/state.rs           +11  (PythRedemptionRate handler)
crates/engine-rs/src/main.rs            +11  (asset-keyed Pyth envelope handler)
crates/dispatcher-rs/src/format.rs       +4  (alert_yield routing)
bot-ts/src/index.ts                     +21  (alert_yield specialized render)
bot-ts/locales/{en,pt-BR}.ftl           +27  (explain_stable_yield + 5 per-asset)
web/lib/yield-sources.ts                NEW  84 lines
web/components/molecules/yield-source.tsx  NEW  45 lines
web/app/asset/[symbol]/page.tsx          +2  (YieldSource conditional render)
crates/xtask/src/main.rs                +95  (Sanctum /v1/lsts coverage check)
assets.toml                            +257  (10 new assets, drop USD+, USD* deferral note)
migrations/0007_seed_phase_a_yield_bearing.sql  NEW  111 lines
migrations/0008_piggybank_pbusdc_mint.sql       NEW   28 lines
docs/superpowers/specs/...              NEW  464 lines (spec)
docs/superpowers/plans/...              NEW  1559 lines (plan)
docs/phase-a/STATUS.md                  NEW  this file
docs/phase-a/completion-evidence-template.md  NEW  template
README.md, ROADMAP.md                    polish
```

19 commits on `main` from `e7dfb1c` → `d31c904` + downstream.

## Discoveries worth keeping

1. **Pyth Redemption Rate feeds replace 4 of 7 yield-bearing adapters.** The
   generic `PythRedemptionRate` IntrinsicStrategy variant + the pyth.rs
   feed→asset routing map (added in Task 4) handle USDY, syrupUSDC, sUSDe,
   ONyc with zero per-issuer Rust code. Strong signal: check Pyth Benchmarks
   BEFORE writing a custom adapter.

2. **Trust nothing in marketing docs.** USD\* was confirmed to be a Save
   Finance cToken via three independent on-chain signals (mint authority,
   Numéraire SDK PRODUCTION_POOLS enumeration, Save reserve layout size).
   Always cross-check mint authority owner before committing to an adapter
   architecture.

3. **Piggybank vault** uses an ASCII `PBKTOKEN` discriminator with embedded
   share-mint + asset-mint pubkeys — cross-checking these makes the decoder
   silent-vault-swap resistant.

4. **Quote-currency mismatches are absorbable.** `SYRUPUSDC/USDC.RR` is
   USDC-quoted and `SUSDE/USDE.RR` is USDE-quoted, but the engine treats
   them as USD-denominated. The ~1bp slippage between USDC/USDE and $1 is
   well inside our 30bps drift threshold. Documented inline for future
   precision tightening if needed.

## What still gates the v1 launch (NOT Phase A scope)

These are pre-existing issues that prevent the engine from producing
`discount`/`state` for the new assets:

- **R2 — Jupiter lite-api 429s** (ROADMAP risk register). Without market
  data, the engine cannot compute discount. Sustained mitigation = Jupiter
  Developer plan ($25/mo).
- **Pyth Hermes SSE flapping** observed during testing. Reconnect logic
  handles it but pipeline freshness suffers. Likely network/TLS, worth
  filing as a separate ticket.
- **Task 20 wall-clock 1h smoke** still to run once Jupiter is unblocked.
  Template at `docs/phase-a/completion-evidence-template.md`.

## How to verify

```bash
# verify-assets must pass
cargo run -p xtask -- verify-assets   # expect: 29 ok / 1 skipped (USD*) / 0 failed

# unit tests
cargo test --workspace                # expect: ~10 tests, 0 failures

# api
curl -s http://localhost:8081/v1/assets | jq 'length'   # expect: 30

# DB freshness (last 5 min)
PGPASSWORD=pegana psql -h localhost -p 5434 -U pegana -d pegana \
  -c "SELECT asset, source, count(*) FROM intrinsic_snapshots
      WHERE ts > NOW() - INTERVAL '5 min' GROUP BY asset, source ORDER BY asset;"
# expect: 22+ rows covering 5 new LSTs + 5 live yield-bearing + 12 baseline assets
```
