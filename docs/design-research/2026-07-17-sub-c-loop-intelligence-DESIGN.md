# Sub-project C — Loop Intelligence: Design & Feasibility (2026-07-17)

**"Solana-side Chaos Labs" — a cross-protocol depeg-cascade simulator.**
**Status:** research complete → **design deliverable, NOT built.** New service + new public claim + ADR-0016 sign-off + recurring Helius cost → 5 founder decisions (§8) gate the build. Nothing in the verdict/receipt path.
**✅ BUILD-READINESS VERIFIED (2026-07-17, second research pass):** every load-bearing fact checked, none wrong, several exceeded. **Kamino** KLend program `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` VERIFIED (Solscan); `@kamino-finance/klend-sdk` **9.1.5** — `getTotalProductTvl(ObligationType)→{tvl,borrows,deposits,avgLeverage}`, `getAllObligationsByDepositedReserve` (anonymous), `KaminoObligation.getStats()` (SYNC; returns a SUPERSET incl. `loanToValue/liquidationLtv/leverage/netAccountValue`), `ObligationTypeTag {Vanilla0,Multiply1,Lending2,Leverage3}` all VERIFIED exact. **Jupiter Lend**: all 3 program IDs VERIFIED mainnet; `@jup-ag/lend-read` **0.0.13** (read-only, "for analytics/indexing/monitoring"), `@jup-ag/lend` 0.1.10; `getAllVaults`/`getVaultState`(totalSupply/totalBorrow) + per-position `getAllPositionIdsForVault`/`batchGetUserPositions`; ~tens of vaults. **MarginFi** (v2): `@0dotxyz/p0-ts-sdk` **2.5.1** confirmed successor. **Helius**: gPA-V2 = 1 credit/page @ 10k accounts + `changedSinceSlot` incremental; **Developer $49/mo (10M) is sufficient with 20–50× headroom — Business $499 NOT required.**
- **Two de-risks the verification surfaced:** (1) the **leveraged-exposure path is FREE via Kamino REST** (`api.kamino.finance/.../leverage/metrics` — live today: ~**7,719** leveraged obligations, $79.8M deposited/$62.3M borrowed, per-reserve-pair TVL+avgLeverage+counts), so **gPA is NOT needed for `loop_exposure`** — only for the Tier-1 per-position HF cascade. (2) The ADR-0016 in-scope (`getAllObligationsByDepositedReserve`, anonymous) vs killed (`getObligationByWallet`, wallet-linked) distinction **maps 1:1 to real SDK methods** → the ADR-0036 invariant is code-enforceable (CI-grep the `*ByWallet*` symbol).
- **⚠️ Founder action:** the **Helius MCP key is dead (401)** — rotate/provision a working key; then fire ONE `getProgramAccountsV2(limit 10000, memcmp main-market, dataSlice len 0)` to nail the exact total-obligation page count (the tier conclusion holds across the whole plausible range regardless — this does NOT gate greenlight).

---

## 0. TL;DR / verdict

Feasible + differentiated, but the honesty ceiling is set by per-protocol data availability:
- **Kamino + Jupiter Lend = GREEN** — typed, per-position, leveraged data (Kamino `klend-sdk` obligation tags Multiply/Leverage; Jupiter Lend Vaults = CDP leverage by construction). A **real cascade model** is achievable, not just a heuristic.
- **MarginFi = AMBER** — full per-bank/account on-chain, but "loop" must be *inferred* (utilization / Arena isolated groups / e-mode).
- **Save (ex-Solend) = AMBER** — clean per-reserve totals, no native leverage → loops inferred, low priority.
- **Loopscale = RED** — order-book/fixed-rate, no clean reserve, no public IDL/SDK, partner-gated API → **defer out of v1.**

**Recommendation: staged, Kamino-first, explicitly *advisory* and walled off from the verifiable peg receipt.** Full 5-protocol/4–6wk is unrealistic at Pegana's honesty bar; a **Kamino+Jupiter "real model" v1 in ~2.5–3.5 weeks** carries the entire "Chaos Labs for Solana" narrative.

---

## 1. Constraints (from your own ADRs + stack)

1. **ADR-0016 boundary (the important one).** Sub-C is *allowed* as a cross-protocol cascade simulator ("cascade math, not portfolio surveillance"); the killed Sub-D was per-wallet monitoring. **The line: reading *anonymous, aggregate* position accounts to build a health-factor distribution = cascade math (allowed); linking positions to a wallet/identity = forbidden (Hard NO #3).** In Kamino SDK terms: `getAllObligationsByDepositedReserve(reserve)` (anonymous) is in-scope; `getObligationByWallet(user)` is killed territory. **Needs explicit founder sign-off (§8-A)** — a credible model reads every position, just never as "your wallet."
2. **ADR-0019 honesty invariant.** Missing/stale/partial data MUST degrade to explicit `coverage: partial` / `UNKNOWN`, never a falsely-precise dollar figure. (Chaos Labs shipped a *misconfigured oracle* in Mar-2026 → ~$26.9M erroneous liquidations; an honest "we don't have depth here" beats a confident wrong number.)
3. **NOT part of the verifiable receipt.** `loop_exposure_usd` + `simulate_depeg_impact` are *advisory analytics*, clearly separated from the signed/reproducible peg verdict so they never pollute the "verifiable" claim. No methodology-version bump.
4. **"Depends on B" is SOFT.** Sub-B sharpens two inputs (does the protocol's own oracle register the depeg; better venue depth for the slippage curve), but C can ship a first cut using assets Pegana already has (existing Jupiter quote-at-size = serviceable slippage curve; existing peg signal = shock trigger). B "makes it better," doesn't block C.

---

## 2. Per-protocol data-access verdicts (build-priority order)

| Protocol | Best access | SDK (npm) | Loop exposure? | Per-position cascade data? | Priority |
|---|---|---|---|---|---|
| **Kamino Lend** | SDK + REST | `@kamino-finance/klend-sdk` | **Explicit** (obligation tags Multiply/Leverage) | **Yes** — `getAllObligationsByDepositedReserve` + `getStats` | **v1** |
| **Jupiter Lend** | Read-SDK + REST | `@jup-ag/lend` + `@jup-ag/lend-read` | **Explicit** (Vaults = CDP leverage) | **Yes** — `getVaultState`/positions | **v1** |
| **MarginFi v2** | RPC/SDK | `@0dotxyz/p0-ts-sdk` (old `@mrgnlabs/marginfi-client-v2` deprecated) | **Inferred** (Arena groups, utilization, e-mode) | Yes (per-`MarginfiAccount`) | v2 |
| **Save (ex-Solend)** | SDK + REST | `@solendprotocol/solend-sdk` | **Inferred** (no native leverage) | Yes (byte-decode) | v2 (thin) |
| **Loopscale** | Partner API only | none public | **Not off-the-shelf** | No | **defer** |
| *DefiLlama* | REST | — | per-reserve totals only, no pairing | No | denominator layer |

**Kamino (GREEN, flagship):** `KaminoMarket.load()` → `getReserveByMint`, `getTotalProductTvl(ObligationType)` returns `{tvl, borrows, deposits, avgLeverage}` **per obligation type** (Vanilla/Multiply/Leverage/Lending → leveraged TVL is a first-class read). `KaminoObligation.getStats()` → `{loanToValue, liquidationLtv, netAccountValue, leverage, borrowLiquidationLimit, …}` = exactly the per-position HF + liquidation-threshold set a cascade needs. REST `api.kamino.finance` gives USD reserve metrics. Enumerate via `getProgramAccountsV2` (1 Helius credit/page, incremental) not legacy gPA (10).

**Jupiter Lend (GREEN, best-instrumented):** Fluid/Instadapp arch; borrow vaults = CDP leverage → zero inference. `@jup-ag/lend-read` (no API key): `vault.getAllVaults()`, `getVaultState` (`totalSupply`/`totalBorrow`), `getVaultConfig` (`supplyToken`,`borrowToken`,`collateralFactor`,`liquidationThreshold`). REST `lite-api.jup.ag/lend/v1/borrow/vaults` (free). Loop attribution: sum X-as-collateral + X-as-debt across vaults. Small universe (tens of vaults).

**MarginFi (AMBER):** `@0dotxyz/p0-ts-sdk`; `Bank` math: `deposits_native = total_asset_shares × asset_share_value`, `borrows_native = total_liability_shares × liability_share_value` (WrappedI80F48), `USD = native/10^dec × oracle_price`. Loop inferred (Arena isolated groups ≈ leverage demand, utilization, e-mode).

**Save (AMBER, thin):** `@solendprotocol/solend-sdk`; REST `api.solend.fi/v1/reserves`; native SPL-lending fork, `borrowedAmountWads`÷1e18. Loop inferred only.

**Loopscale (RED, defer):** order-book Credit Vaults, no shared reserve, no public SDK/IDL, partner-gated API. Not buildable to Pegana's standard without a partner deal → cover only at DefiLlama aggregate, or defer.

**DefiLlama (denominator layer):** free `yields.llama.fi/pools` (per-reserve `totalSupplyUsd`/`totalBorrowUsd`/`ltv`), `api.llama.fi/protocol/{name}`. Broad Solana coverage for asset-level *denominators* + coverage — but per-reserve only (no borrow-vs-collateral pairing) + ~hourly. Sizes the market; can't power the cascade core.

---

## 3. `protocol-indexer-ts` — service architecture

**Why a new TS service (not a Rust `indexer-rs` source):** the protocol SDKs are TypeScript (`klend-sdk`, `@jup-ag/lend-read`, `p0-ts-sdk`). Reimplementing Kamino obligation/leverage decode in Rust = large, fragile reverse-engineering against a moving target (the "new attack surface" ADR-0016 warns of). Reusing audited vendor SDKs in TS is the honest, lower-risk path + fits the stack (you already run `mcp-ts` Bun/Hono reading Postgres via `pg` + Redis via `ioredis`). Tradeoff: doesn't reuse Rust RPC-failover/metrics — mirror the *patterns* (primary→fallback RPC, per-source liveness gauges, idempotent upserts), not the code.

```
protocol-indexer-ts/  (Bun + TS, containerized like mcp-ts)
  src/adapters/{kamino,jupiter-lend,marginfi,save,defillama}.ts
  src/core/{loop-classify,rpc,pg,metrics}.ts
  src/poll.ts   // ~5 min cadence (heavier than price feeds; obligation enumeration is the cost)
```
- Cadence ~5 min; `getProgramAccountsV2` + `changedSinceSlot` incremental between full sweeps.
- Writes to the **same** TimescaleDB + Redis the Rust stack uses; `mcp-ts`/`api-rs` read the materialized tables (no cross-service RPC).
- Stores **anonymous** rows keyed by obligation/position pubkey only — never wallet→identity (ADR-0016). Can prune to distribution stats after rollup.
- Adapter error/stale → `coverage`/`stale` flag; simulate reports reduced coverage, never silent under-count (ADR-0019).
- **Helius cost** (the main recurring cost): gPA-V2 = 1 credit/page vs legacy 10; Kamino obligation enumeration is the driver. Rough envelope = Developer ($49) or Business ($499) depending on obligation counts — **needs a live gPA count to size (§8-D).**

---

## 4. Schema (Timescale hypertables, follows conventions)

```sql
-- Per (asset, protocol) rollup — the materialized loop_exposure_usd. (ADR-0036 variant A.)
CREATE TABLE loop_exposure_snapshots (
    asset TEXT NOT NULL REFERENCES assets(symbol),
    protocol TEXT NOT NULL,                    -- 'kamino'|'jupiter_lend'|'marginfi'|'save'
    collateral_usd NUMERIC(30,18),             -- asset supplied as collateral (all positions)
    collateral_lev_usd NUMERIC(30,18),         -- ...of which in LEVERAGE/loop positions
    debt_usd NUMERIC(30,18),                   -- asset borrowed (shorted)
    loop_basis TEXT NOT NULL,                  -- 'typed'|'inferred_utilization'|'aggregate_only'
    position_bucket TEXT,                      -- ADR-0036 inv.7: k-floored RANGE ('<5'|'5-20'|'20-50'|'>50'), NEVER a raw count
    coverage TEXT NOT NULL,                    -- 'full'|'partial'|'aggregate'|'stale'|'unknown'
    source_slot BIGINT, ts TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (asset, protocol, ts)
);
SELECT create_hypertable('loop_exposure_snapshots','ts',chunk_time_interval => INTERVAL '1 day');
SELECT add_retention_policy('loop_exposure_snapshots', INTERVAL '180 days');
CREATE INDEX loop_exposure_asset_ts_idx ON loop_exposure_snapshots (asset, ts DESC);

-- ADR-0036 variant A: aggregate HF-BAND DISTRIBUTION (NOT per-position rows).
-- The cascade model reads THIS. NO position pubkeys, NO owner/authority field:
-- anonymously-enumerated obligations are folded into k-floored bands each sweep
-- and the pubkeys discarded (invariants 1, 2, 7). The original draft's
-- `loop_positions` (per-position) table is DROPPED — deferred to variant B behind
-- a fresh privacy review + invariants 7-8 as hard preconditions.
CREATE TABLE loop_hf_distribution (
    asset TEXT NOT NULL REFERENCES assets(symbol),  -- collateral asset
    protocol TEXT NOT NULL,
    hf_band TEXT NOT NULL,                     -- health-factor band, e.g. '<1.0'|'1.0-1.05'|'1.05-1.1'|'1.1-1.25'|'>1.25'
    position_bucket TEXT NOT NULL,             -- inv.7 k-floored range; the ROW is OMITTED entirely if count < k (=5)
    collateral_usd NUMERIC(30,18) NOT NULL,    -- SUM over the band (band SUPPRESSED if one position holds > ~45%, inv.7 l-diversity)
    debt_usd NUMERIC(30,18),
    liquidation_ltv NUMERIC(10,6) NOT NULL,    -- representative liquidation threshold for the band
    liquidation_bonus NUMERIC(10,6),
    source_slot BIGINT, ts TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (asset, protocol, hf_band, ts)
);
SELECT create_hypertable('loop_hf_distribution','ts',chunk_time_interval => INTERVAL '1 day');
SELECT add_retention_policy('loop_hf_distribution', INTERVAL '180 days');
CREATE INDEX loop_hf_dist_asset_ts_idx ON loop_hf_distribution (asset, ts DESC);
```
`loop_exposure_usd(asset)` = latest `SUM(collateral_lev_usd)` across protocols (+ `coverage` badge). Keep `collateral_usd` companion → "of $X supplied, $Y is leveraged."

---

## 5. `simulate_depeg_impact(asset, shock_bps)` — the model

**A credible cascade (Chaos Labs / Gauntlet reference) needs 6 ingredients:** per-position health factors; per-collateral liquidation params (threshold, bonus, close factor); **endogenous DEX price impact** (liquidators dump → pool re-prices → slippage deepens as the cascade runs); sequential worst-HF-first ordering; **liquidator profitability gate** (liquidation only if `bonus > slippage + fees`; when negative, liquidations STOP → residual = bad debt); bad-debt tally. **Pegana's 7th edge:** does the protocol's *own* oracle even register the depeg? (Kamino TWAP/EWMA, Jupiter bands — a depeg can be invisible to liquidations for a while; where Sub-B plugs in.)

**Tiered (ship the honest floor, label everything):**
- **Tier 0 — aggregate heuristic** (Save, Loopscale-via-DefiLlama): `exposed_notional = loop_exposure_usd`; naive threshold-cross. Report as a **range, labeled heuristic, no liquidity model.** Sizing bound only.
- **Tier 1 — position-level cascade** (Kamino + Jupiter, the real model): apply shock `p'=p×(1−shock/10⁴)` → recompute HF → collect underwater positions → sum liquidatable collateral (respect close factor) → feed size into a **DEX slippage curve** (reuse Pegana's existing Jupiter quote-at-size in `indexer-rs`) → realized liquidation price → **profitability gate** (if `bonus < realized_slippage + fees` → **bad debt**, not liquidated) → **one re-pricing pass** (v1; full iterative convergence = v2) → `{liquidatable_usd, estimated_bad_debt_usd, positions_affected, realized_price, coverage}`.
- **Cross-protocol contagion (v1.5):** a Kamino + a Jupiter liquidation of the *same* collateral hit the *same* DEX pool → **share the slippage curve across protocols per asset.** This is the genuinely novel "cross-protocol" part + the reason to do it multi-protocol.

**Honest limits (must appear in output + docs):** exogenous shock is an assumption not a prediction; single re-pricing pass under-counts deep cascades (v2 = convergence); liquidators modeled rational-and-instant; oracle lag can delay the whole cascade (qualitative in v1 unless B lands); **coverage explicit** (any protocol not Tier-1 flagged; `coverage: partial` never a confident total hiding gaps); correlation/second-order out of scope v1.

---

## 6. MCP tool + REST endpoint (read materialized tables — NO on-chain reads on the request path)

**MCP** (`mcp-ts/src/tools/`, zod, `readOnlyHint`; x402 paid-tool candidate): `simulate_depeg_impact({symbol, shock_bps})` → `{asset, shock_bps, loop_exposure_usd, liquidatable_usd, estimated_bad_debt_usd, positions_affected, realized_price, by_protocol[], coverage: full|partial|aggregate, covered_protocols[], model_tier: cascade|heuristic, ts}`; `isError:true`+`coverage:"stale"` when the latest snapshot is older than N min (ADR-0019). Companion free `get_loop_exposure({symbol})`.
**REST** (`api-rs`, Axum+sqlx, `/v1`+OpenAPI): `GET /v1/assets/{symbol}/loop-exposure` (latest rollup, 5s Redis cache) + `GET /v1/assets/{symbol}/simulate-depeg?shock_bps=NNN` where `NNN` is restricted to the **preset grid `{100,250,500,1000,2000}`** (ADR-0036 inv.8 — reject off-grid values; no continuous sweep) (Tier-1). **Implement the model once (Rust `api-rs` from `loop_hf_distribution`, the k-floored HF bands — NOT per-position rows) and have the MCP tool call it** — avoid two divergent models. Outputs coarse-rounded, `positions_affected` bucketed, rate-limited (inv.8). Public copy = no internal jargon ("if this drops X%, ~$Y of leveraged positions liquidate, ~$Z bad debt, covering Kamino + Jupiter Lend").

---

## 7. Effort (staged, honest — the roadmap's "5 protocols/4–6wk" is unrealistic at the honesty bar)

| Stage | Scope | Effort |
|---|---|---|
| **C0 Foundation** | `protocol-indexer-ts` scaffold (Bun, RPC failover, metrics, PG), schema migration, Helius sizing | 3–4 d |
| **C1 Kamino exposure** | `klend-sdk` adapter → snapshots + positions; `get_loop_exposure` tool + REST | 4–5 d |
| **C2 Jupiter Lend** | `@jup-ag/lend-read` adapter → same tables | 2–3 d |
| **C3 Simulate (Tier 1)** | cascade over Kamino+Jup, shared slippage curve, MCP+REST+tests | 5–7 d |
| **C4 Hardening** | 1:1 live-chain validation, coverage/stale flags, UI card, backtest a past event (USDe Oct-2025) | 3–4 d |
| **v1 total (Kamino+Jupiter, real model)** | | **~2.5–3.5 wk** |
| C5 MarginFi (inferred) | `p0-ts-sdk` + Arena/utilization classifier | +4–5 d |
| C6 Save + DefiLlama | solend-sdk + denominators | +3–4 d |
| Loopscale | partner API | deferred/blocked |

Kamino+Jupiter v1 carries the whole "Chaos Labs for Solana" narrative (the two biggest Solana lending venues + the two with *typed* leverage) — the demand-relevant milestone, not full coverage.

---

## 8. FOUNDER DECISIONS (build should not start until settled)

- **A. ADR-0016 line.** Confirm **anonymous, non-identity-linked position enumeration = cascade math (in-scope)**, distinct from the killed per-wallet monitor. Conservative variant: store only the *distribution* (HF buckets), discard position pubkeys after rollup. *Recommend: in-scope, worth an explicit ADR sign-off, distribution-only as the safe variant.*
- **B. v1 scope.** *Recommend **Kamino + Jupiter Lend only** for v1* (both green, typed-leverage, SDK-clean); MarginFi/Save v2; **Loopscale deferred.** Accept a 2-protocol v1, or preserve the full-5 framing (→ 6+ wk, drags in red/amber)?
- **C. Advisory vs verifiable.** Confirm it ships **explicitly walled off from the signed peg receipt** — labeled estimate, no methodology bump, `coverage` flags everywhere. *Recommend yes — the guardrail that keeps it from undermining "verifiable."*
- **D. Fidelity + cost.** (1) v1 = single-re-pricing-pass Tier-1 with a real slippage curve; full convergence v2 — OK? (2) Helius tier: needs a **live gPA obligation count** to size; OK to provision up to Business ($499/mo) if volume warrants, or cap at Developer ($49) + lengthen cadence?
- **E. v1-worthy NOW given "demand is the gap"?** New service + maintenance + public claim = real cost. BUT it's the roadmap's explicit "killer feature," a credible **design-partner magnet / demand wedge** ("Chaos Labs for Solana" — fundable, ownable on a chain where only P0/Project 0 is emerging), and build-to-demand is your active posture. *Recommend: greenlight Kamino+Jupiter v1 (C0–C4) as a demand bet, staged, with a **go/no-go review after C1** (Kamino exposure live) before committing to the simulate engine (C3). Do a first cut of the oracle-health input alongside; don't let B block C.*

---

## Sources
Kamino: `@kamino-finance/klend-sdk` autodocs via Context7; api.kamino.finance. Jupiter Lend: github.com/jup-ag/jupiter-lend, dev.jup.ag/docs/lend, github.com/Instadapp/fluid-solana-programs, github.com/code-423n4/2026-02-jupiter-lend. MarginFi: npm (@mrgnlabs deprecation, @0dotxyz/p0-ts-sdk), github.com/mrgnlabs/marginfi-v2 (`state/bank.rs`), docs.marginfi.com. Save: @solendprotocol/solend-sdk, api.solend.fi. Loopscale: docs.loopscale.com, defillama.com/protocol/loopscale, halborn.com (Apr-2025 hack). Chaos/Gauntlet: chaoslabs.xyz (stETH:ETH), gauntlet.xyz, Mar-2026 oracle incident (ainvest/crypto.news), blog.redstone.finance (Project 0). DefiLlama: api-docs.defillama.com. Helius: helius.dev/docs/billing/credits, /blog/faster-getprogramaccounts. Internal: `crates/indexer-rs/`, `mcp-ts/src/tools/`, `crates/api-rs/src/routes/`, `docs/adr/0016`, `docs/adr/0019`, `ROADMAP.md`.
