# Sub-project B — Risk Signals: Design & Decisions (2026-07-17)

**Status:** research complete; safe increment (API-synth ORACLE_DEGRADED, annotate-only) **spec'd + recommended, ready to build on one-line founder sign-off** (thresholds + surface choice below). Heavier options flagged.
**Method:** deep Context7 / Solana-docs / registry research (read-only) → this doc. All external claims cited; internal claims carry `file:line`.

---

## 0. The reframe that governs everything

Pegana is an **off-chain, read-only monitor**. It never lands a Solana tx to read a price — Pyth via Hermes SSE (`crates/indexer-rs/src/sources/pyth.rs:165`), Jupiter/DexScreener via HTTP. **On-chain compute costs (Lazer "15K CU", Switchboard "20–100k lamports/update") are borne by on-chain consumers, not Pegana.** What matters per venue: is there an **off-chain read path** (HTTP/WS/`getAccountInfo`), its latency, and whether Pegana must run a **crank**.

Second reframe: **the market leg is already a whole-DEX aggregate** (`MarketStrategy::JupiterUsd` routes across Orca/Phoenix/Raydium; DexScreener aggregates top pairs — `crates/common-verify/src/lib.rs:234`). A per-venue leg does **not** improve the single market price — its only value is **cross-source divergence / fragmentation detection**. Never replace `market`; only add independent legs.

---

## 1. ORACLE_DEGRADED — the "amber" oracle-trust layer

### The gap
Today oracle-trust is a **cliff**: trusted (green) until conf/price hits the hard gate `PYTH_CONFIDENCE_GATE_BPS = 500` (`thresholds.rs:166`, ADR-0032), then straight to UNKNOWN (dark). **There is no amber.** And market↔oracle divergence — the exact signal that catches a cascade *early* (one source pricing a move before the other) — lives only in the browser (`web/lib/asset/legs.ts:89` `sourcesDisagree`, tolerance 75 bps), never server-side.

### Three degradation dimensions — all data already exists
| Dimension | Data source (stored) | Today |
|---|---|---|
| conf-width | `oracle_snapshots.confidence` + `.price` (indexer writes both, `sinks/postgres.rs:130-143`) | hard gate at 500 bps → UNKNOWN; display label `high/med/low` at 10/100 bps (`state.rs`) |
| divergence | market leg (`discount_snapshots`) ↔ oracle leg (asof-join, `api-rs/src/routes/assets.rs:736`) | frontend-only badge |
| staleness | `oracle_snapshots.publish_time` | hard `stale_source` at 15 min → UNKNOWN (API-synth, `lib.rs:23`) |

### Recommended increment — API-synthesized advisory (annotate-only, zero trust-pipeline touch)

> **Not built yet — awaiting founder sign-off on thresholds + surface.** Tracing the wiring showed a precise conf-band needs `oracle_snapshots.confidence` + `publish_time` surfaced into the response (the `/history` asof-join I shipped carries oracle *price* only), and the clean version either extends the perf-sensitive `/v1/assets` list query or adds new response fields. That's a real multi-surface change with genuine design choices — so it's spec'd here, not blind-built overnight on a trust-adjacent path. One-line greenlight (thresholds OK + which surface) → ~3–5 days to build with the full validation loop.

Synthesized at the **API layer exactly like `stale_source`** (`lib.rs:23-29`: "Synthesized by the API layer (not the engine)"). **No methodology/engine/`Receipt`/canonical-hash/backtest touch** → provably cannot change any verdict or receipt hash. Additive advisory field; consumers that ignore it are unaffected.

`oracle_degraded ∈ { none | conf_wide | divergent | stale_soft }`, computed from stored data with **conservative defaults** (flagged for calibration, same discipline as `stale_source`'s 15 min and the 500 bps gate):

- `ORACLE_DEGRADED_CONF_WARN_BPS = 100` — conf/price in **[100, 500) bps** (below the hard gate; reuses the existing "low" display cut). `< 100` healthy, `≥ 500` already UNKNOWN.
- `ORACLE_DIVERGENCE_WARN_BPS = 75` — market↔oracle gap (borrowed from `SOURCES_DISAGREE_TOLERANCE_BPS`) while the discount itself is not yet in an alerting band.
- `ORACLE_STALENESS_WARN_SECS = 45` — oracle age past ~45 s (spot) but below the 15-min hard `stale_source`. (NAV/RR feeds step daily → excluded / wider; gated on `market_kind`.)

Precedence: `stale_source`/hard-gate (UNKNOWN) **win**; `oracle_degraded` only annotates a tick that is NOT already collapsed. Orthogonal to the peg verdict: a tick can be `{PEGGED, oracle_degraded: conf_wide}` or `{DEPEG, oracle_degraded: divergent}`.

**Why API-synth and not engine-side (v1):** it's non-invasive, reversible, mirrors the `stale_source` precedent, needs no methodology bump / ADR / backtest re-baseline, and does not foreclose a heavier engine-computed version later. The heavier version (below) is a founder decision.

### FOUNDER DECISIONS — ORACLE_DEGRADED
1. **Keep it advisory (API-synth) — RECOMMENDED — or promote to a verdict input?** Promotion (engine-computed, receipt-carried, a `final_state` input) = methodology bump + ADR + **byte-exact backtest re-baseline** + `Receipt` schema change (touches the public verifier). Big blast radius; do only with intent.
2. **Calibrate the 3 thresholds** (100 bps / 75 bps / 45 s) against `oracle_snapshots`/`discount_snapshots` history — the same "near-zero historical trips" proof ADR-0032 mandated for the 500 bps gate. Defaults are conservative starting points, not tuned.
3. **Does divergence ever *escalate* (fire a DRIFT-like early-warning when neither source is individually off-peg)?** This is the "catch the cascade earlier" option (research option D) — genuinely new alerting; needs calibration + backtest + ADR. Recommend later, behind a disabled-by-default flag (depth-gate pattern).
4. **Does ORACLE_DEGRADED gate ALERT egress** (suppress a fresh DRIFT webhook when oracle-degraded) or purely annotate? Suppression risks hiding a real early signal — recommend annotate-only.

---

## 2. Venue-aware feeds — honest ranking

**Phoenix (orderbook/depth) > Switchboard (independent oracle, free Crossbar poll + dispersion) >> Orca ("TWAP" does not exist).**

### 2a. Phoenix orderbook — highest value
- On-chain CLOB; deep books mainly for **SOL/USDC + a few majors** (most Pegana stables/LSTs have no/thin Phoenix market → source only where a liquid market exists, primarily SOL-quoted LSTs).
- **Off-chain read:** RPC `getAccountInfo` on the market account, decode with `phoenix-sdk` (`Market::get_ladder()`/`get_typed_ladder()`) → L2 bids/asks → mid/microprice. **No crank** (atomic settlement) so the account is always current; `accountSubscribe` optional (deferred per memory — RPC-poll fine). Cost **$0** (reads).
- **Unique value:** a real **orderbook** — (1) independent mid for fragmentation, (2) top-of-book **spread** as a stress signal, (3) **depth-to-move-X%** — a direct feed for the disabled depth-gate (ADR-0034). No other source provides depth-at-price.
- Plug-in: `sources/phoenix.rs`, `MarketStrategy::PhoenixClob { market_pubkey }`, `route_label="phoenix_clob"`. **~5–8 days.**

### 2b. Switchboard On-Demand — independent oracle, free off-chain reads
- Permissionless feeds; majors likely covered, long tail **not guaranteed** (needs feed creation + funding). Confirm at `explorer.switchboardlabs.xyz`.
- **Off-chain read:** **Crossbar `simulate_solana_feeds`** (HTTP, current value without landing a tx) is the genuinely **FREE, no-subscription** path — but an HTTP poll (~hundreds of ms), not a push. **Surge** (WebSocket, ~sub-100 ms delivery on *every* tier) is a **PAID tiered SWTCH-token subscription** (on-chain `subscription_init`) whose gate is **update cadence + capacity, not push speed**: the free "Plug" tier updates only **~every 10 s / 2 feeds / 1 connection** (not a real-time feed); **real-time cadence requires paid Pro (450 ms, ~$3,000/mo) or Enterprise (streaming, ~$7,500/mo)** — verified against docs.switchboard.xyz 2026-07-17. So the $0 path is Crossbar-simulate polling; Surge only if a tier is purchased. Avoid the on-chain `PullFeedAccountData` path (only fresh if someone cranks it).
- **Bonus:** Switchboard's own cross-oracle `std_dev`/`mean` = an **independent confidence-width** number → a second input to ORACLE_DEGRADED.
- Plug-in: `sources/switchboard.rs` (Crossbar-simulate poll for the $0 path; Surge WS only on a paid tier), independent-oracle leg. **~4–6 days.**

### 2c. Orca Whirlpool "TWAP" — **does not exist (drop it)**
The ROADMAP's "Orca TWAP" rests on a mistaken premise. Whirlpool has **no Uniswap-V3-style price TWAP.** The `Oracle` account (Adaptive Fees) stores **only volatility-tracking state** (`volatility_accumulator`, tick-group references, reserved) — confirmed from `whirlpool/src/state/oracle.rs`. No cumulative-tick, no observation array, no time-weighted price. Pegana could read a single pool `sqrt_price` (spot) + sample its own EWMA, but that's thinner than Jupiter's aggregate and already visible via Jupiter routing. **Recommend: drop Orca as a distinct price source.**

### 2d. Pyth Lazer (now "Pyth Pro") — **not a fit, defer**
Off-chain via WS (`real_time`/`fixed_rate@50ms`), `leUnsigned` payload, **API-key-gated, paid** (no confirmed free tier). The "15K CU/20 feeds" spec is the **on-chain verification** cost — irrelevant to Pegana (§0). Pegana's detection is **EWMA-smoothed discount** on slowly-moving assets (NAV/RR feeds step daily); the USDe-cascade gap was **not Hermes latency** (1 Hz is ample) but **no cross-source divergence** — which §1 already addresses. **Recommend: DEFER** (revisit only with a latency-sensitive product + budget).

### FOUNDER DECISIONS — venues
1. Wire **Phoenix + Switchboard** as **independent divergence legs (NOT market replacements)**; **drop Orca**, **defer Lazer**? (recommended)
2. Switchboard read path: **free Crossbar-simulate HTTP poll** (recommended — the only genuinely $0 path, ~seconds latency) vs **paid Surge** (~$3k/mo Pro for 450 ms real-time cadence; free Plug tier is only ~10 s) vs on-chain cranked feeds (lamports + feed creation/funding for the long tail)?
3. Accept Phoenix's **narrow coverage** (only assets with a liquid Phoenix market)?

---

## 3. VenueFragmentation — annotation, NOT a new PegState

`PegState` (`common-verify/src/lib.rs:372`) = `Pegged/Drift/Depeg/Critical/BlackSwan/Unknown` — the **public verdict enum**. A PegState answers *"how far from peg?"* on a severity ladder. **"Venues disagree" is orthogonal** — a data-quality/microstructure statement, no natural rank (not "worse than Depeg"). Jamming it in corrupts the enum and detonates a huge blast radius: API schema + DB enum + `rank()` (`thresholds.rs:220`) + webhook renderers + verifiable badge + the **public "Five states" honesty copy/docs** + CLI receipt schema + **byte-exact backtest golden**.

**Recommendation: model "venues disagree" as the ORACLE_DEGRADED `divergent` sub-reason (annotate-only), or a `state_reason` on an existing UNKNOWN when the disagreement is so large no verdict is trustworthy** (reserved slot `no_oracle_crosscheck` already exists, `api-rs/src/routes/assets.rs:171`). Both are out-of-hash, non-methodology, coverage-tolerant. If the founder still wants it first-class: it must rank at **severity-0 alongside Unknown** (never above BlackSwan), requires **≥2 live independent venues per asset** (uneven public semantics), and eats the full blast radius above (+ "Five states"→"Six states" everywhere).

---

## 4. Two build paths (the discipline)
- **Advisory / out-of-hash (light):** API-synth ORACLE_DEGRADED (§1, spec'd), divergence flag, new `state_reason` values, display legs. No receipt-hash impact, no backtest re-baseline, no public-copy change, no methodology bump. **Days.**
- **Verdict-changing (heavy):** engine-computed/receipt-carried ORACLE_DEGRADED, any venue leg as a `final_state` input, a VenueFragmentation PegState. **Each = methodology bump + ADR + byte-exact backtest re-baseline + public-verdict/docs change.** Same discipline as ADR-0032/0.7.0.

**Recommended sequence:** (1) API-synth ORACLE_DEGRADED (spec'd, needs greenlight); (2) Phoenix + Switchboard independent legs; (3) defer Lazer; (4) venue-fragmentation = annotation, not a PegState; drop Orca.

---

## Sources
Pyth Pro/Lazer: docs.pyth.network/price-feeds/pro (+ /subscribe-to-prices, /how-lazer-works); pyth.network/blog/introducing-pyth-lazer. Switchboard: github.com/switchboard-xyz/on-demand, /solana-sdk; docs.switchboard.xyz; Surge (switchboardxyz.medium.com). Orca: github.com/orca-so/whirlpools; dev.orca.so (oracle = adaptive-fee volatility). Phoenix: github.com/Ellipsis-Labs/phoenix-sdk, /phoenix-v1; docs.rs/phoenix-v1.
Internal: `thresholds.rs:166,187,220`; `lib.rs:12-29`; `engine-rs/src/state.rs`; `web/lib/asset/legs.ts:89`; `api-rs/src/routes/assets.rs:171,736`; `common-verify/src/lib.rs:234,372`; `indexer-rs/src/sinks/postgres.rs:130`.
