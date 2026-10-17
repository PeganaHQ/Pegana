# Pegana — System Architecture (V2)

> Canonical map of the whole system, backend + frontend. Written 2026-07-17 after
> a full 33-agent audit + 1:1 validation. For decisions see `docs/adr/`; for deploy
> see `docs/runbooks/`; for the trust spec see `docs/pegana-trust-layer-v0.1.0/`.

Pegana is a **peg-risk oracle / Trust Layer for Solana**: it watches stable
assets + LSTs, publishes a per-asset peg **verdict** (PEGGED · DRIFT · DEPEG ·
CRITICAL · BLACK_SWAN · UNKNOWN), and — for severe transitions — anchors a
tamper-evident **receipt** on-chain so anyone can recompute the peg history
("the Grant Thesis"). Editorial-SaaS product (V5 rebrand), not a CLI/terminal.

---

## 1 · Data flow (end to end)

```
  on-chain / APIs            indexer-rs                 Postgres+Redis        engine-rs                     api-rs            web (Next 16)
  ─────────────────          ──────────                 ──────────────        ─────────                     ──────            ─────────────
  Pyth (Hermes)         →   sources/*  →  intrinsic_snapshots  ┐            try_recompute per asset:      /v1/assets    →   /asset, /lst,
  Sanctum sol-value         (12 tasks)    discount_snapshots   ├→  Redis  →   compute_discount → EWMA →     /v1/audit         /dashboard,
  SPL stake pools                         oracle_snapshots     │   pub/sub    classify+hysteresis →         /history          /status, /events
  Hylo PDA                                intrinsic_liveness   │            transition_decide →            /v1/calibration    (SWR hooks →
  Jupiter quotes                          liquidity_obs        │            sanity/pyth/liveness gate →     (+ CORS)          lib/api/client)
  lst-directory.com                       token_supply         ┘            final_state + Receipt  →  DB
  DEX Screener                                                              ↳ severe → dispatcher-rs (webhooks) + on-chain SPL-Memo commit
```

- **indexer-rs** — 12 ingestion tasks writing snapshots. Log-and-continue on task
  exit (recovery = `pegana_source_task_up`/staleness gauges, NOT process-restart).
- **engine-rs** — the verdict pipeline (§3). Emits a hashed `Receipt` per tick;
  anchors Depeg/Critical/BlackSwan on-chain when `PEGANA_COMMIT_KEYPAIR` is set.
- **api-rs** — read API (Axum). Asof-joins the legs; CORS-gated public reads.
- **dispatcher-rs** — signed webhook egress (Ed25519), SSRF-guarded, retrying.
- **methodology** — the pure, versioned formula core (shared by engine + the
  public verifier `pegana-replay-cli` + the `xtask` backtest, so all three agree).

---

## 2 · Crates (Rust workspace)

| Crate | Role | Key files |
|---|---|---|
| `methodology` | Pure formula core + receipt/canonical-hash + `rederive` | discount.rs, ewma.rs, thresholds.rs, transition.rs, rederive.rs, canonical.rs, receipt.rs |
| `engine-rs` | Live verdict loop, on-chain commit, receipt emission | main.rs (`try_recompute`), state.rs (`EngineState`), onchain_commit.rs |
| `indexer-rs` | 12 ingestion sources + sinks | sources/{pyth,sanctum,spl_stake_pool,hylo,jupiter,lst_directory_audit,piggybank_pb,perena,dex_screener,tokens_xyz,token_supply}, sinks/{postgres,redis_pub} |
| `api-rs` | Read API + `oracle_degraded` classifier + calibration | routes/{assets,peg,stats,alerts,history,audit,calibration}, oracle_degraded.rs |
| `dispatcher-rs` | Signed webhook fan-out (SSRF-guarded, retry) | main.rs, webhook.rs |
| `pegana-replay-cli` | Public verifier of record (`pegana-replay`) | src/main.rs (exit codes 0-5) |
| `common` / `common-verify` | Shared types, `webhook_url` SSRF guard, `PegState` | webhook_url.rs |
| `xtask` | Backtest replay runner (byte-exact golden) | backtest/{runner,types,mod} |

**Trust invariant:** `engine try_recompute`, `methodology rederive`, and the
`xtask` runner apply the SAME verdict steps + gates in the SAME order, so a
receipt always re-derives to the verdict it froze. `rederive` is what the public
CLI runs; the canonical hash is RFC-8785 JCS via serde (byte-exact across arches).

---

## 3 · The verdict pipeline (per asset, per tick)

1. **`compute_discount`** = `1 − market/intrinsic` (LSTs cancel the shared SOL/USD
   multiplier via the SOL-denominated path). `checked_div` throughout — a
   zero/overflow intrinsic → `None` → skip (never a panic, never false PEGGED).
2. **plausibility** — `|discount| < 1.0` guard.
3. **EWMA** — `apply_ewma_pure`, α = 0.3, seeds at raw on cold-start.
4. **classify + hysteresis** — Schmitt-trigger bands (ADR-0023) off per-asset
   `thresholds` (drift/depeg/critical bps), OR the **CR path** for hyUSD
   (`classify_cr_with_hysteresis`, collateral-ratio bands).
5. **`transition_decide`** — confirm-up (30s) / decay-down (120s) time hysteresis.
6. **override → UNKNOWN** if ANY fires (worst-case, conservative-only):
   - `premium_sanity_violated` (premium > 1000 bps on a NAV-anchored class — garbage-LOW intrinsic)
   - `discount_sanity_violated` (discount > 3000 bps — garbage-HIGH intrinsic, the JLP incident)
   - `pyth_confidence_gate_violated` (conf/price > 500 bps on any required feed — ADR-0032)
   - `intrinsic_liveness_gate_violated` (frozen backing — ADR-0038, **ships disabled**)
7. **Receipt** — freeze the inputs (`InputsFrozen`) + computed verdict, canonical-hash,
   persist; severe states → on-chain SPL-Memo commit + webhook fan-out.

All gate divisions are `checked_div` (audit F-12: raw `Decimal /` panics on overflow).

---

## 4 · V2 features (all on `landing/v2-port`, NOT deployed)

| Feature | Layer | ADR / commit |
|---|---|---|
| **V5 rebrand** (coral→lavender, pills/aurora, real `<table>`) | web | — |
| **ORACLE_DEGRADED** — amber oracle-trust badge (market↔oracle divergence / wide conf / stale) | api-synth + web | ADR-0035 |
| **3-leg source-divergence** — oracle leg on `/history` + divergence | api + web | mig 0067 |
| **INTRINSIC_DEGRADED** — amber "backing may be frozen" badge (directory flags) | web-only | ADR-0037 |
| **market-cap** — `token_supply` × price on the screener | mig 0065 + api + web | — |
| **lst self-audit** — realizable-vs-booked haircut tripwire (recalibrated 300bps) + directory flags | indexer + ops | — |
| **epoch-lag detectors** — SplStakePool + Hylo frozen-backing gauges/alerts | indexer + ops | — |
| **intrinsic-liveness gate** — force-UNKNOWN a frozen backing, **disabled-default** | methodology+engine+indexer, mig 0068 | ADR-0038 |
| **verifier hardening** — severe-alert `not_applicable` → exit-5, not false PASS | pegana-replay | ADR-0033 |
| **Pyth conf-gate** — force-UNKNOWN on wide confidence | methodology 0.7.0 | ADR-0032 |
| **depth-gate** — confidence-cap on thin market, disabled-default | engine | ADR-0026/0034 |

**Advisory vs in-hash:** ORACLE_DEGRADED, INTRINSIC_DEGRADED, the self-audit, and
the epoch-lag gauges are **out-of-hash** (never move a verdict). The Pyth conf-gate
+ intrinsic-liveness gate + depth-gate are **in-hash** (force UNKNOWN); the latter
two ship **disabled-default** (env flags), provably inert + byte-exact until calibrated.

---

## 5 · Frontend (web/, Next 16 + Tailwind v4)

- **Routes:** `/asset/[symbol]` (hero + chart + rail + tabs), `/lst` (directory),
  `/dashboard`, `/status` (+ `/status/calibration`), `/events`, `/compare`, `/audit`.
- **Verdict surface:** `asset-hero-v2` (state pill + Pyth-confidence badge +
  OracleDegradedBadge + IntrinsicDegradedBadge + `state_reason` copy), `asset-chart`
  (lightweight-charts, legs/bands modes), `asset-rail`.
- **Data:** SWR hooks (`use-asset`, `use-assets`, `use-history`, `use-alerts`,
  `use-lst-liveness`) → `lib/api/client` → the Rust API; types in `lib/api/types.ts`.
- **INTRINSIC_DEGRADED** is frontend-only: `/api/lst-liveness` route proxies the
  server-only directory fetch → `flags{stale,deprecated,dead}` → the amber badge.
- **Standard:** every data table is a real `<table>` (see `web/AGENTS.md`).

---

## 6 · Trust primitive (receipts)

- `Receipt` = `{schema_version, methodology_version, assets_toml_canonical,
  inputs_frozen, expected_computed, expected_receipt_sha256, state_reason}`.
- **Byte-exact:** the hash is JCS(InputsFrozen)+JCS(Computed) prefixed by the
  methodology version. Additive fields use `skip_serializing_if` so an absent/
  default value is OMITTED → old receipts + the backtest golden hash identically.
- **Verifier** (`pegana-replay`): re-hash + (v2) `rederive` + (with `--alert-id`)
  on-chain SPL-Memo + pinned-signer check. Exit 0 PASS · 1 FAIL · 2 ERROR ·
  3 VERSION · 4 ONCHAIN_MISMATCH · 5 ONCHAIN_INCOMPLETE.

---

## 7 · Ops

- **Migrations** `migrations/00NN_*.sql` (latest 0068 = intrinsic_liveness).
- **Alerts** `ops/alerts/pegana.yml` (26 rules, `promtool`-checked + unit-tested).
- **Metrics** Prometheus → Grafana (`grafana.pegana.xyz`).
- **Deploy** `scripts/deploy.sh` on Hetzner `${PEGANA_DEPLOY_SERVER}`; web via Vercel
  on push to main. **Never push origin/main casually = prod deploy.** Full ordered
  activation in `docs/runbooks/v2-launch.md`.

---

## 8 · Known gaps (2026-07-17 audit, tracked)

- **Contract seams (narrowed 2026-07-18):** the UI now consumes the authoritative
  per-asset `thresholds` from `/v1/assets` on every band/gauge/alert surface
  (`thresholdsFor(..., asset.thresholds)` threaded through the relaunch 1:1 sweep),
  so a Postgres recalibration is no longer a silent UI no-op; `reconcileBps` is now
  the single shared spread source (app + embed badge agree byte-for-byte).
  Remaining: `anchor`/`risk_side`/`worst_abs_24h` are still partly re-derived
  client-side (founder-deferred).
- **Liveness coverage:** Perena NAV-accrual stall IS detected (ADR-0038
  `nav_accrual_stall`); Piggybank remains uncovered — a stalled crank republishes a
  frozen NAV (pbUSDC itself is deactivated). Numéraire staleness (Pyth SOL/USD) is
  now gated at ingestion (2026-07-18). Account decoders ARE fuzzed (proptest in
  perena / piggybank / spl_stake_pool).
- **No live-prod validation:** the whole V2 is proven in code/tests on the branch,
  not against the running prod stack (296 commits ahead of `origin/main`).
