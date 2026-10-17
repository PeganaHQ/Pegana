# Pegana — Phase A: yield-bearing expansion (30 assets) design spec

> v1.0 · 2026-05-21 · approved direction · ready for implementation plan
>
> Companion to: `2026-05-21-frontend-design.md` (web v1 contract)

## 1. Scope

**Current baseline (verified by `grep -c "^\[\[assets\]\]" assets.toml` → 18):**

The original v1 design had 14 assets. After commits `73fb435` (full Hylo coverage) and `c86dd27` (live pipeline), 4 Hylo-derived assets were added (`hyloSOL`, `hyloSOL+`, `sHYUSD`, `xSOL`). Current `assets.toml` has **18 assets**. `README.md` still says "14" and is stale — to be updated as part of this work.

**What we add in Phase A (before v1 public launch):**

- **+6 LSTs via Sanctum** — config-only, no new adapter code
- **+8 yield-bearing stables** — each with its own on-chain reader (new `IntrinsicStrategy` per issuer)
- **Reuse existing `AssetClass::StableYield`** (already in `crates/common/src/lib.rs:27`) — was originally for Hylo's `sHYUSD` and semantically fits the 8 new NAV-based stables. No new class needed.
- **Front-end + Telegram bot adjustments** — filter, card layout, payload class, glossary
- **`README.md` count corrected** to reflect actual asset total

**Result:** asset universe grows from 18 → **32**.

**Explicitly out of scope for Phase A (deferred to Phase B post-launch):**

- Wallet-connect / personalized dashboard / portfolio view
- Cross-protocol APY comparison (Kamino / MarginFi / Drift / Loopscale lending rates)
- RWA marketplace integrations (RECC Finance project pools)
- StandX `dUSD`, HUMA Finance — TVL/credibility below the Tier 1 inclusion bar
- Boring fiat stables we explicitly rejected: `USDG`, `FDUSD`, `EURC`, `AUSD`

**Stack additions:** zero new external dependencies. All new adapters reuse existing patterns from `crates/sources/hylo_onchain.rs` (Borsh decode of on-chain accounts via `solana-client`).

---

## 2. Final asset catalog (28)

### LSTs — pegged to SOL (15)

Existing (9): `jitoSOL`, `mSOL`, `bSOL`, `INF`, `dSOL`, `bbSOL`, `JupSOL`, `hyloSOL`, `hyloSOL+`

**New (6):**

| Symbol | Name | Issuer | Sanctum-listed? | Pyth feed? |
|---|---|---|---|---|
| `vSOL` | The Vault SOL | The Vault | ✅ | TBD |
| `compassSOL` | Compass SOL | Solend-aligned | ✅ | TBD |
| `BNSOL` | Binance Staked SOL | Binance | ✅ | TBD |
| `picoSOL` | Pico SOL | Solflare | ✅ | TBD |
| `kySOL` | Kamino Yield SOL | Kamino | ✅ | none |
| `hSOL` | Helius Staked SOL | Helius | ✅ | none |

All 6 use `intrinsic = { kind = "sanctum_lst", symbol = "<sanctum-id>" }` — Sanctum's batch `/v1/sol-value/current?lst=...&lst=...` already handles them.

### Yield-bearing stables — peg-to-NAV (10)

Existing (2): `sHYUSD` (Hylo stability pool exchange rate), `hyUSD` (Hylo CR-based; reclassified `stable_cdp` → stays as is)

**New (8):**

| Symbol | Name | Issuer | Mechanism | New strategy variant |
|---|---|---|---|---|
| `USDY` | Ondo USD Yield | Ondo Finance | T-bill rebasing | `OndoUsdyNav` |
| `sUSDe` | Staked USDe (bridged) | Ethena | Funding-arb share rate | `EthenaSusdeRate` |
| `syrupUSDC` | Maple Syrup USDC | Maple | Institutional lending NAV | `MapleSyrupRate` |
| `sUSD` | Solayer USD | Solayer | T-bills + restaking MEV | `SolayerSusdRate` |
| `USD*` | USD Star | Perena | Multi-stable pool NAV | `PerenaUsdStarPool` |
| `ONyc` | OnRe Tokenized Reinsurance | OnRe | Reinsurance NAV | `OnreOnycNav` |
| `pbUSDC` | Piggybank USDC vault | Piggybank | Funding-rate arb cross-DEX | `PiggybankPbVault` |
| `USD+` | Streamflow USD+ | Streamflow | T-bill daily NAV | `StreamflowUsdPlusNav` |

### Other stables (unchanged — kept as $1-pegged baseline)

`USDC`, `USDT`, `PYUSD` (Token-2022), `USDe` (Ethena delta-neutral $1), `USDS` (Sky CDP $1), `BRZ` (BRL fiat-pegged via FX), `xSOL` (Hylo synth lev — unchanged)

### Mint verification

Every new mint is marked `verified = false` in `assets.toml` until `cargo xtask verify-assets` confirms:
1. Mint exists on mainnet
2. Owner program matches expected (`spl-token`, `token-2022`, or issuer-specific program)
3. Decimals match issuer docs
4. Reachable via Sanctum (for LSTs) or readable via issuer-specific PDA decode (for yield stables)

**CI fails until all 14 new mints pass verification.** Same gate as today.

---

## 3. Domain changes (`crates/common`)

### 3.1 New `IntrinsicStrategy` variants

Add to `crates/common/src/types.rs`:

```rust
pub enum IntrinsicStrategy {
    // existing variants unchanged
    SanctumLst { symbol: String },
    FixedOneUsd,
    HyloCr { exchange_program: Pubkey, stability_pool: Pubkey },
    HyloShyusdRate { stability_pool: Pubkey },
    HyloXsolNav { exchange_program: Pubkey },
    PythFxCross { feed: String, invert: bool },

    // NEW — yield-bearing stables (one variant per issuer, type-safe)
    OndoUsdyNav { oracle: Pubkey },
    EthenaSusdeRate { mint: Pubkey, share_program: Pubkey },
    MapleSyrupRate { pool: Pubkey, program: Pubkey },
    SolayerSusdRate { share_account: Pubkey, program: Pubkey },
    OnreOnycNav { pool: Pubkey, program: Pubkey },
    PiggybankPbVault { vault: Pubkey, program: Pubkey },
    StreamflowUsdPlusNav { source: Pubkey },
    PerenaUsdStarPool { pool: Pubkey, underlying: Vec<Pubkey> },
}
```

**Design rationale:** explicit variants per issuer (not a generic `NavRedemption { reader: Box<dyn> }`). Three reasons:
1. **Type-safe verify-assets** — each variant's pubkeys are validated separately
2. **Same pattern as Hylo today** — we already have 3 Hylo-specific variants, this scales the pattern
3. **No dyn dispatch in hot path** — engine recompute stays branch-on-enum, faster + simpler to reason about

### 3.2 `AssetClass` — reuse existing `StableYield`

No new class needed. `crates/common/src/lib.rs:24-27` already defines:

```rust
/// Yield-bearing wrapper of a stable token (e.g. Hylo sHYUSD wraps
/// hyUSD with stability-pool yield). Intrinsic is the wrapper's exchange
/// rate × underlying NAV.
StableYield,
```

The semantics match perfectly: intrinsic = NAV (growing), market = Jupiter quote, discount = `1 - market/NAV`. The 8 new yield-bearing stables all get `class = "stable_yield"` in `assets.toml`.

Original spec proposed `StableYield` as a new variant — removed as redundant after reviewing actual code.

### 3.3 Threshold defaults for new `StableYield` assets

```toml
thresholds_bps = { drift = 30, depeg = 100, critical = 250 }
```

Wider than `StableFiat` (15/50/200) — NAV reads have inherent noise (oracle updates, share rate rounding), and a yield-bearing stable trading -50bps to NAV is NORMAL secondary-market behavior (illiquidity discount), not depeg. Tuned per-issuer during dogfood (Epic 11).

**Note:** existing `sHYUSD` (the only current `StableYield` asset) uses tighter thresholds (30/100/300 bps) per its `assets.toml` config — that stays unchanged. The 30/100/250 default above applies only to new assets.

---

## 4. Source adapters (8 new in `crates/sources/`)

### 4.1 Common shape per adapter

Each adapter is a standalone module in `crates/indexer-rs/src/sources/`, following the contract of the existing `hylo.rs` (429 lines, on-chain Borsh decode pattern):

```rust
pub struct <Issuer>Adapter {
    rpc: Arc<RpcClient>,
    config: <Issuer>Config,
    redis: redis::Client,
}

impl <Issuer>Adapter {
    pub async fn run(self, mut shutdown: ShutdownSignal) -> Result<()> { /* ... */ }

    async fn poll_once(&self) -> Result<NavReading> { /* on-chain fetch + decode */ }

    fn expected_layout_hash(&self) -> [u8; 32] { /* IDL drift detection */ }
}
```

Each adapter:
1. **Polls** the relevant on-chain account (cadence per adapter below)
2. **Decodes** with hardcoded Borsh layout (or oracle parse)
3. **Computes** NAV in USD (using cached Pyth feed when needed, e.g., `SOL/USD` for SOL-denominated assets)
4. **Persists** to `intrinsic_snapshots` via shared writer
5. **Publishes** to `pegana:src:<issuer>` Redis channel
6. **Emits metrics**: `pegana_<issuer>_polls_total`, `pegana_<issuer>_latency_seconds`, `pegana_<issuer>_decode_failures_total`

### 4.2 Per-adapter detail

| File | Cadence | Source | Estimated effort | Critical risk |
|---|---|---|---|---|
| `ondo_usdy.rs` | 30s | Ondo price oracle (Pubkey TBD) | 1 day | Oracle staleness — abort if `publish_time` > 5min |
| `ethena_susde.rs` | 30s | Share rate via bridged mint program | 1.5 day | Bridge variant — verify Solana mint is rate-bearing, not just wrapper |
| `maple_syrup.rs` | 30s | Maple Pool PDA decode | 2 days | Maple Pool layout — fetch IDL via `anchor idl fetch`, snapshot fixture |
| `solayer_susd.rs` | 30s | Share account (rebasing) | 2 days | Rebasing balance — share rate ≠ NAV directly, formula must be tested |
| `perena_usdstar.rs` | 30s | Numéraire pool decode + 3 underlying balances | 3-4 days | Multi-underlying — pool composition is dynamic, must read live |
| `onre_onyc.rs` | 60s | OnRe pool PDA | 2 days | NAV updated daily by issuer — cadence too tight wastes RPC |
| `piggybank_pb.rs` | 30s | pb-vault NAV decode | 2-3 days | Mint + program addresses TBD — fetch from piggybank.fi docs |
| `streamflow_usdplus.rs` | 60s | Daily NAV oracle | 1.5 day | Updated 1×/day — alert on stale-beyond-26h |

**Total adapter effort:** 14-17 days.

### 4.3 RPC budget audit

| Source | Calls / 30s | RPS sustained |
|---|---|---|
| Sanctum (existing, batch) | 2 (1 batch) | 0.07 |
| Jupiter (existing) | 14 (round-robin) | 0.45 |
| Pyth (existing SSE) | streaming | — |
| Hylo (existing) | 1 PDA decode | 0.03 |
| **8 new adapters** | ~8 PDA/oracle decodes | **0.27** |
| **Total** | | **~0.82 RPS** |

Well within `mainnet-beta` public limit (~10 RPS) + Helius free tier (10 RPS). No new RPC infrastructure needed.

### 4.4 IDL drift protection (mandatory per adapter)

Every adapter MUST expose `expected_layout_hash()`. The existing IDL drift cron (Epic 5, runs hourly) extends to:
1. Fetch current IDL from `anchor idl fetch <program>` for each new program
2. Hash it with SHA-256
3. Compare to hardcoded `expected_layout_hash`
4. On divergence → emit Sentry alert + set affected assets to `state = UNKNOWN`

**This is non-negotiable.** Borsh decode against a changed layout is silent corruption — we must hard-fail visible.

---

## 5. Engine integration (`crates/engine`)

### 5.1 Subscription expansion

`Engine::main_loop` subscribes to all `pegana:src:*` channels. Add 8 new pattern subscriptions:
- `pegana:src:ondo`
- `pegana:src:ethena`
- `pegana:src:maple`
- `pegana:src:solayer`
- `pegana:src:perena`
- `pegana:src:onre`
- `pegana:src:piggybank`
- `pegana:src:streamflow`

Use `PSUBSCRIBE pegana:src:*` (already done today) — zero code change to the subscription itself.

### 5.2 Discount formula for `StableYield`

In `crates/engine/src/recompute.rs`, add branch:

```rust
let discount = match asset.class {
    AssetClass::StableFiat | AssetClass::StableDn | AssetClass::StableCdp => {
        // unchanged: peg target = $1 (constant)
        let intrinsic_usd = Decimal::ONE;
        Decimal::ONE - (market_usd / intrinsic_usd)
    }
    AssetClass::StableYield => {
        // NEW: intrinsic = NAV (growing over time)
        let nav_usd = latest_intrinsic.value_usd;  // from adapter
        Decimal::ONE - (market_usd / nav_usd)
    }
    AssetClass::Lst | AssetClass::StableYield | AssetClass::StableFx | AssetClass::SynthLev => {
        // unchanged
        // ...
    }
};
```

State machine **unchanged**. PEGGED/DRIFT/DEPEG/CRITICAL boundaries apply the same way — only the input formula changes.

### 5.3 Alert payload class

`AlertEvent` gains a new `payload_class` variant. Dispatcher (Epic 7) uses it to pick the right Telegram message template:
- `lst` (existing)
- `stable_fiat` (existing)
- `stable_cdp` (existing — Hylo)
- `stable_fx` (existing — BRZ)
- `yield_bearing` (NEW) — shows "NAV / market / discount" trio + 24h NAV growth rate

---

## 6. Front-end changes (`web/`)

Minimal — existing organisms already filter by class.

### 6.1 `dashboard-filters.tsx`

Add "Yield-bearing" to the class dropdown. Update class color tokens in `globals.css`:
```css
--color-class-yield-bearing: <pick from design palette>;
```

### 6.2 `asset-card.tsx`

For `class === "StableYield"`, show:
- **NAV: $X.XXXX** (instead of "Peg: $1.00")
- **24h NAV growth: +X.XXX%** (small caption under price)
- **Market discount: -X.X bps** (existing pip semantics)

### 6.3 `asset-hero.tsx` (asset detail page)

New "Yield source" section describing the issuer's mechanism (T-bills, funding arb, restaking, etc.). Content lives in `lib/glossary.ts`:

```ts
export const yieldSources: Record<string, { mechanism: string, description: string, link: string }> = {
  USDY:    { mechanism: "T-bills", description: "Ondo holds short-term U.S. Treasury bills...", link: "..." },
  syrupUSDC: { mechanism: "Institutional lending", description: "Maple pools lend USDC to vetted borrowers...", link: "..." },
  // ... 8 entries
};
```

### 6.4 New types in `lib/api/types.ts`

```ts
export type AssetClass =
  | "lst"
  | "stable_fiat"
  | "stable_dn"
  | "stable_cdp"
  | "stable_yield"
  | "stable_fx"
  | "synth_lev"
  | "yield_bearing_stable";  // NEW
```

**Front-end effort:** 2 days.

---

## 7. Telegram bot changes (`bot-ts/`)

### 7.1 New payload formatter

In `dispatcher-rs/src/format.rs`, add `format_yield_bearing()`:
```
🟡 USDY drift detected
NAV: $1.0843 · Market: $1.0801 · Discount: -38 bps
24h NAV growth: +0.0142% (T-bills)
Threshold: 30/100/250 bps
```

### 7.2 `/explain` localization

8 new entries in `bot-ts/locales/en.ftl` and `bot-ts/locales/pt-BR.ftl`:
- `explain-USDY`, `explain-sUSDe`, `explain-syrupUSDC`, `explain-sUSD`, `explain-USD-STAR`, `explain-ONyc`, `explain-pbUSDC`, `explain-USD-PLUS`

Each entry: 2-3 sentences PT + EN explaining mechanism + risk profile.

**Bot effort:** 1 day.

---

## 8. Testing strategy (MANDATORY before merge)

User explicitly emphasized "tenha certeza que tudo irá funcionar corretamente." This section is the contract.

### 8.1 Per-adapter unit tests

Each new adapter MUST have:

1. **Fixture-based decode test** — capture a real on-chain account (`solana account <pubkey> --output json`), check fixture into `crates/sources/fixtures/<issuer>/`, write a test that decodes the fixture and asserts NAV equals the known value from the issuer's public dashboard at that snapshot time.

2. **Layout hash regression test** — assert `expected_layout_hash()` matches a hardcoded byte array. Forces explicit acknowledgment when layout changes.

3. **Error path tests** — empty account, malformed bytes, stale oracle (publish_time > threshold), RPC timeout. Each should produce a typed error, never panic.

### 8.2 Engine integration tests

In `crates/engine/tests/`:

1. **Per-class discount test** — for each new asset, inject a synthetic `IntrinsicReading` + `MarketReading`, assert the computed discount matches a hand-calculated value (8 new tests).

2. **State transition test** — assert `StableYield` honors the same hysteresis (30s confirm-up, 120s decay-down) as other classes.

### 8.3 Pre-merge mainnet smoke test

Before merging the PR for each adapter:

1. Run the adapter against mainnet for 30 minutes
2. Compare every produced NAV to the issuer's public dashboard (Ondo's page for USDY, Solayer's page for sUSD, etc.)
3. Tolerance: ≤ 5 bps drift (NAV reads can lag by one block; >5 bps means decode is wrong)
4. Document the result in the PR description with screenshots

**No adapter merges without this evidence.**

### 8.4 Verify-assets CI gate

`cargo xtask verify-assets` is extended to validate every new mint:
- Mint exists, owner program correct, decimals correct (existing checks)
- For LSTs: present in Sanctum's `/v1/lst-list` response
- For yield-bearing stables: relevant PDA(s) exist and are decodable by the adapter

CI fails until all 14 new assets pass.

### 8.5 IDL drift smoke test (CI)

Extend the existing IDL drift cron logic to a CI check: on every push, fetch IDLs for all new programs (Maple, Solayer, OnRe, Piggybank, Streamflow, Perena) and compare to hardcoded hashes. Fail CI on mismatch.

---

## 9. Risk register additions

Extend `ROADMAP.md` risk register:

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R13 | New issuer changes account layout silently | High | Critical | `expected_layout_hash()` per adapter + hourly drift cron + CI check (§8.5) |
| R14 | NAV oracle stale (e.g. USDY oracle hasn't updated in 24h+) | Medium | High | Per-adapter `max_staleness_secs` config; on exceed → `state = UNKNOWN` + Sentry alert |
| R15 | Yield-bearing stable depegs while NAV reading lags | Medium | High | Independent staleness check on both intrinsic and market readings; discount only computed when both fresh |
| R16 | Bridged sUSDe Solana mint diverges from Ethena's source-of-truth share rate | Medium | High | Cross-check Solana share rate against Ethena's Ethereum oracle every hour; flag `low_confidence` if delta > 10 bps |
| R17 | Perena pool composition reads succeed but underlying balance is misreported | Low | High | Sum-of-balances invariant test: pool USD value must equal weighted sum within 1bp tolerance |
| R18 | Piggybank vault loses delta-neutrality (similar to Apr-2026 Drift exploit exposure) | Medium | Medium | Already a "monitor this" use case — Pegana fires alerts on depeg as designed; no additional mitigation needed beyond accurate NAV reads |

---

## 10. Sequencing & milestones (5 weeks)

| Week | Focus | Deliverable |
|---|---|---|
| 1 | Domain + Sanctum LSTs + verify | `assets.toml` updated, 6 LSTs verified, `IntrinsicStrategy` enum extended, `AssetClass::StableYield` added |
| 2 | Tier-1 adapters (3) | `ondo_usdy.rs`, `solayer_susd.rs`, `streamflow_usdplus.rs` (the 3 simpler oracle-based ones) + fixture tests |
| 3 | Tier-2 adapters (3) | `ethena_susde.rs`, `maple_syrup.rs`, `onre_onyc.rs` + fixture tests + IDL fetches |
| 4 | Complex adapters (2) | `perena_usdstar.rs`, `piggybank_pb.rs` (multi-underlying / less-documented) + mainnet smoke |
| 5 | Engine + FE + bot + integration tests | Discount formula branch, asset-card layout, payload formatter, /explain entries, full E2E smoke |

Each week ends with all adapters from that week running against mainnet for ≥1h with NAV reads matching issuer dashboards within 5bps.

---

## 11. Definition of done

Phase A is complete when:

1. ✅ All 30 assets show up in `/dashboard` with live data flowing (USD+ deferred to v1.5 — Streamflow not yet on mainnet; USD* + pbUSDC pending custom adapters)
2. ✅ `cargo xtask verify-assets` passes for all 32 mints
3. ✅ `cargo test --workspace` passes (existing 8 unit tests + new adapter tests + engine integration tests)
4. ✅ Mainnet smoke evidence (§8.3) attached to each adapter's PR
5. ✅ IDL drift cron green for 7 consecutive days against all new programs
6. ✅ Telegram bot's `/explain <asset>` returns the right content for all 8 new yield-bearing entries (PT + EN)
7. ✅ Telegram alert templates produce correctly formatted output for `yield_bearing` payload class (manual test in dogfood chat)
8. ✅ No regressions: all 18 original assets still flow correctly (snapshot tests + dashboard visual diff)
9. ✅ `README.md` and `ROADMAP.md` updated to reflect 32-asset universe

Once DoD is met, Phase A is merged to `main` and we proceed to: production deploy on Hetzner (Epic 10) → dogfood (Epic 11) → public launch.

---

## 12. Out-of-scope reminder (Phase B, post-launch)

The wallet-connect personalized dashboard discussed during brainstorming is **deferred entirely**. Phase B will be its own spec + plan cycle after v1 ships. Captured in `ROADMAP.md §v1.5 backlog` for visibility.

---

## Appendix A — Mint addresses (TBD during implementation)

All marked `verified = false` until confirmed via mainnet RPC + issuer docs during week 1:

- `vSOL`, `compassSOL`, `BNSOL`, `picoSOL`, `kySOL`, `hSOL` → cross-ref Sanctum `/v1/lst-list`
- `USDY` → Ondo docs
- `sUSDe` (Solana mint) → Ethena bridge docs (likely Wormhole NTT)
- `syrupUSDC` (Solana mint) → Maple Solana deployment announcement
- `sUSD` → `susdabGDNbhrnCa6ncrYo81u4s9GM8ecK2UwMyZiq4X` (preliminary, verify)
- `USD*` → Perena Numéraire pool docs
- `ONyc` → OnRe docs
- `pbUSDC` → Piggybank vault docs (need to scrape, fewer public refs)
- `USD+` → Streamflow docs

---

## Appendix B — References

- [Perena Numéraire — USD* hub-and-spoke pool](https://www.gate.com/learn/articles/what-is-perena/5917)
- [OnRe ONyc — NAV-based, not pegged to $1](https://docs.onre.finance/technical-resources/frequently-asked-questions)
- [Piggybank — pb-tokens, delta-neutral funding-rate arb](https://www.piggybank.fi/)
- [Solayer sUSD — rebasing T-bill + MEV restaking](https://docs.solayer.org/assets/susd/yield-bearing-stablecoin/what-is-susd)
- [Maple syrupUSDC on Solana via Drift](https://thedefiant.io/news/defi/maple-finance-launches-yield-bearing-syrupusdc-collateral-for-perps-on-drift)
- [Solana yield-bearing stables Q1-2026 ranking](https://stablecoininsider.org/yield-bearing-stablecoins-2026/)
