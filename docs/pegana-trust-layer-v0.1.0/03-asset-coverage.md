> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# 03 — Asset Coverage

> The complete asset list for Trust Layer v0.1.0. Ground truth: `assets.toml` has **28 entries** (22 active + 6 inactive: BRZ, JupUSD, EURC, dzSOL, vSOL, JLP). INF is **active**. The 5 Phase 0 additions (JupUSD, JLP, EURC, dzSOL, vSOL) were committed `active = false` during the calibration window and flip to `active = true` at launch (06-11) per ADR-0002 if calibration is green — so at launch up to **27 active / 28 entries** (BRZ stays inactive). Phase 14 adds **6 more**. With deep LST focus and JupUSD as new strategic stable.

---

## 1. Coverage thesis

**Pegana over-indexes on Solana-native LSTs and stablecoins with high integration in Solana DeFi loops** (Kamino Multiply, Loopscale, Jupiter Lend, MarginFi, Drift cross-margin). We do NOT chase coverage breadth (CoinGecko/DefiLlama dominate that); we go deep on assets that are likely to be loop collateral, leveraged positions, or yield-farming bases.

### Why LST-heavy?

1. **Pegana's existing depth**: 8 of 22 active assets are already LSTs (INF included). The team has expertise in `sol_per_lst` mechanics, SOL/USD multiplier race cancellation (per the 2026-05-25 incident note in `docs/incident-2026-05-25-lst-burst.md`), and Sanctum integration.
2. **LSTs ARE collateral**: every major Solana lending protocol (Kamino, MarginFi, Jupiter Lend, Drift) accepts LSTs as collateral. When an LST drifts, loops liquidate. Pegana's primary value is sensing this 10-60 minutes before cascade.
3. **LSTs drift naturally**: validator MEV competition + epoch boundaries + redemption queues all create routine 10-50bps drifts that are NOT depegs. Distinguishing "natural drift" from "stress drift" is the methodology's specialty.
4. **LSTs are Solana-only**: no cross-chain confusion. Pegana's mainnet-only posture works perfectly.
5. **JitoSOL alone has $1.2B+ TVL** with 14.3M SOL staked (per Sanctum 2026 ranking). The market is real.

### Why JupUSD is strategic

JupUSD (launched January 2026 by Jupiter + Ethena Labs) is the **most important new stablecoin on Solana** for Pegana:

- Backed 90% by USDtb (BlackRock BUIDL-collateralized) + 10% USDC
- Native to Jupiter ecosystem (the largest DEX aggregator on Solana)
- Reserve operations managed by Ethena Labs (same team behind USDe — exposes Pegana to that risk profile)
- Will likely become a major loop collateral in Kamino, Loopscale, Drift within 90 days of launch
- Has both a centralized peg (USDC fallback) AND a yield-bearing component (USDtb yields) — interesting hybrid risk profile

**Strategic value for Pegana**: monitoring JupUSD makes Pegana the *de facto* peg-risk oracle of the Jupiter ecosystem. That's an obvious integration story — Jupiter dashboards can embed Pegana's JupUSD status badge.

---

## 2. Current state: 22 active + 6 inactive assets

These are LIVE in production. Source of truth: `assets.toml` (28 entries total; 6 inactive via `active = false`: BRZ, JupUSD, EURC, dzSOL, vSOL, JLP). INF is **active**.

### LSTs (8 active)

| Symbol | Status | Class | Intrinsic source | Market source | Thresholds (bps) drift / depeg / critical |
|---|---|---|---|---|---|
| **jitoSOL** | ✅ active | LST (MEV-share) | Sanctum (sol_per_lst) | Jupiter quote (SOL numeraire) | 45 / 110 / 250 |
| **mSOL** | ✅ active | LST | Sanctum | Jupiter | 40 / 100 / 250 |
| **bSOL** | ✅ active | LST | Sanctum | Jupiter | 45 / 110 / 250 |
| **INF** | ✅ active | LST (Sanctum Infinity multi-LST pool) | Sanctum (sol_per_lst) | Jupiter (SOL numeraire) | 140 / 280 / 560 |
| **bbSOL** | ✅ active | LST (BonkBot via Bybit) | Sanctum | Jupiter | 45 / 110 / 250 |
| **JupSOL** | ✅ active | LST (Jupiter) | Sanctum | Jupiter | 60 / 150 / 300 |
| **hyloSOL** | ✅ active | LST (Hylo collateral) | Hylo on-chain (NAV decode) | Jupiter | 55 / 140 / 280 |
| **hyloSOL+** | ✅ active | LST (Hylo yield-boosted) | Hylo on-chain | Jupiter | per calibration |

**INF status note**: INF is **active** in production (`assets.toml:64`, `verified = true`, Sanctum `sol_per_lst` intrinsic + Jupiter SOL-numeraire market). It runs hotter than the other LSTs (24h p99 ~112 bps), hence the wider 140 / 280 / 560 bps thresholds calibrated 2026-05-25. An earlier draft of this spec listed INF as inactive; that is no longer true.

For exact mint addresses + Pyth feed IDs, see `assets.toml` directly — values verified against mainnet via the `verify-assets` CI workflow.

**Note on jitoSOL/mSOL/bSOL/JupSOL/bbSOL**: these use the **SOL-denominated path** when both `intrinsic_sol` and `market_sol` are available, to cancel the `pyth(SOL/USD)` multiplier race. See `06-engine-changes.md § compute_discount` for the LST-specific logic.

### Fiat stables (3 active)

| Symbol | Status | Class | Intrinsic | Market | Thresholds (bps) |
|---|---|---|---|---|---|
| **USDC** | ✅ active | StableFiat | Fixed $1 | Pyth USDC/USD | 15 / 50 / 200 |
| **USDT** | ✅ active | StableFiat | Fixed $1 | Pyth USDT/USD | 15 / 50 / 200 |
| **PYUSD** | ✅ active | StableFiat (Token-2022) | Fixed $1 | Pyth PYUSD/USD | 15 / 50 / 200 |

### Delta-neutral stable (1 active)

| Symbol | Status | Class | Intrinsic | Market | Thresholds (bps) |
|---|---|---|---|---|---|
| **USDe** | ✅ active (already in production) | **StableDn** (Delta-neutral, Ethena) | Fixed $1 (delta-neutral basis backs the peg) | Pyth USDe/USD | 25 / 100 / 300 |

USDe is **symmetric** (alerts fire on both discount and premium), not direction-sensitive like StableYield. The 2025-10-10 cascade event is replayable against this asset's current production methodology.

### CDP stables (2 active)

| Symbol | Status | Class | Intrinsic mechanism | Thresholds |
|---|---|---|---|---|
| **hyUSD** | ✅ active | StableCdp (Hylo) | Hylo CR ratio (collateral SOL / hyUSD supply × $1/SOL_USD) | CR% 150/130/110/100 |
| **USDS** | ✅ active (already in production) | StableCdp (Sky, ex-DAI) | Fixed $1 via Sky bridge (NTT) invariant | bps 20/75/250 |

### Yield-bearing stables (7)

These have a **growing NAV** (not fixed $1). Pegana only alerts on **discount-to-NAV**, not premium (configured via `state_for_bps_discount_aware` direction-sensitive logic).

| Symbol | Class | Mint | Intrinsic source | Market source |
|---|---|---|---|---|
| **USDY** | StableYield (Ondo) | `A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6` | Pyth USDY/USD (issuer-attested redemption rate) | Pyth spot |
| **sUSDe** | StableYield (Ethena) | `Eh6XEPhSwoLv5wFApukmnaVSHQ6sAnoD9BmgmwQoN2sN` | Pyth SUSDE/USDE.RR | Pyth spot |
| **syrupUSDC** | StableYield (Maple) | `2Cra8j6JqGgVF1qPiX5G9hxgvqJYsHvKj8XxhRn1QUJW` | Pyth SYRUPUSDC/USDC.RR | Pyth spot |
| **sUSD** | StableYield (Solayer, Token-2022 InterestBearing) | `susdabGDNbhrnCa6ncrYo81u4s9GM8ecK2UwMyZiq4X` | Solayer share rate (on-chain decode) | Pyth spot |
| **ONyc** | StableYield (OnRe reinsurance) | `ONyc6BgvKKyamWZWPyXunVK86RmTLpGFumNYdpyAEHU` | Pyth NAV.ONYC/USD (issuer attestation) | DexScreener fallback |
| **sHYUSD** | StableYield (Hylo stability pool wrapper) | `H1zNm5kQv3xCx9rDLEYBxBPiNs5RhrUFkqLT6rL8azqA` | Hylo stability pool on-chain rate | DexScreener |
| **pbUSDC** | StableYield (Piggybank delta-neutral) | `pbUS6oAvk9zM8RKnGB1evTzBLuk1V5tWXNK4SDqFmJv` | Piggybank vault PDA (decoded NAV) | DexScreener |

### Synthetic / Leverage (1)

| Symbol | Class | Mint | Intrinsic | Notes |
|---|---|---|---|---|
| **xSOL** | SynthLev (Hylo) | `xS7Lkmw9hbnsHGFvCEEMXqXKBKa3UCJDcvjP1q5N3wD` | Hylo NAV = (collateral_sol − hyusd_supply_in_sol) / xsol_supply | Wider thresholds — not a peg-watched asset, monitored as arbitrage/redemption-stress signal |

---

## 3. Phase 0 additions (passive calibration: 2026-05-28 → 2026-06-10)

**5 new assets** join `assets.toml` with `active=false` during the calibration window. They accumulate calibration data alongside the 22 currently active assets. On 2026-06-11 launch day, they flip to `active=true` if calibration p99 is within plausible thresholds.

> USDe and USDS are **already in `assets.toml` as active**. They are part of the existing calibration v1 dogfood window. They are NOT Phase 0 additions, even though they appear as "TBD samples" in `docs/CALIBRATION-v1.md` (which means "need calibration data", not "need to be added").

### Tier-1 stablecoin additions (3 new)

#### **JupUSD** ⭐ NEW STRATEGIC ADD (validation pass 5)

| Field | Value |
|---|---|
| Class | **StableDn** (Delta-neutral synthetic, matches USDe pattern: $1-pegged with yield-bearing backing) |
| Mint | ⚠️ Verify with Jupiter announcement (launched January 2026) — likely `Jup6V…` |
| Intrinsic | Fixed $1 — JupUSD maintains 1:1 redemption against USDC via single-tx settlement (per Jupiter docs). Backing composition (90% USDtb + 10% USDC) is the **collateral**, not the peg target. |
| Market | Pyth JUPUSD/USD if available; else Jupiter quote against USDC |
| Pyth feed | ⚠️ Confirm in Pyth Network catalog |
| Thresholds (bps) | drift=25, depeg=100, critical=300 (mirrors USDe given similar delta-neutral mechanism) |
| Active in Phase 0 | `false` (passive 14-day calibration) |
| Active at launch | `true` (06-11) |

**Why this matters**: JupUSD is the most-likely-to-be-widely-used new stablecoin on Solana. Jupiter ecosystem integration = Pegana visibility in dashboards consumed by every Solana DEX user.

**Risk**: shares Ethena's operational risk profile (USDtb is Ethena-issued, reserves managed by Ethena Labs). If Ethena has a bad day, JupUSD is exposed. This is exactly why peg monitoring on JupUSD matters.

#### **JLP** (Jupiter Perps LP token)

| Field | Value |
|---|---|
| Class | StableYield (treated as index-basket with yield from perps fees; conservative class until full index-basket class exists) |
| Mint | `27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4` ✅ confirmed via Solscan |
| Intrinsic | Jupiter Perps pool NAV (sum of underlying assets / shares). Pool address: `5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq`. Composition ~47% SOL + 15% BTC + 8% ETH + 30% stables. |
| Market | Pyth JLP/USD: `0xc811abc82b4bad1f9bd711a2773ccaa935b03ecef974236942cec5e0eb845a3a` ✅ confirmed |
| Thresholds (bps) | drift=60, depeg=200, critical=500 |
| Active in Phase 0 | `false` |

**Why this matters**: JLP is the largest collateral base for Kamino Multiply loops on the JLP/USDC pair. When JLP NAV diverges from market price, those loops face liquidation risk. Pegana coverage = early warning for that segment.

**Note**: JLP behavior is **NOT** a traditional peg — it's an index basket NAV vs market. We monitor as "discount to NAV" signal. Threshold tuning will refine post-calibration.

#### **EURC** (Circle Euro)

| Field | Value |
|---|---|
| Class | StableFiat (EUR-pegged, not USD) |
| Mint | ⚠️ Verify in Circle developer docs (launched on Solana Dec 2023, mint should be discoverable via Circle's `developers.circle.com`) |
| Intrinsic | Fixed €1 — but must be converted to USD via Pyth EUR/USD for display |
| Market | Pyth EURC/USD (composite) or Pyth EURC/EUR + EUR/USD calculation |
| Pyth feed | Pyth EUR/USD: `0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b` ✅ confirmed |
| Thresholds (bps) | drift=20, depeg=75, critical=250 |
| Active in Phase 0 | `false` |
| Special handling | First non-USD-pegged asset; requires `peg_target = EUR` in `assets.toml`. Engine already supports `PegTarget::EUR` per `crates/common/src/lib.rs:38`. |

**Why this matters**: demonstrates multi-currency coverage. Differentiates Pegana from competitors that are USD-only.

### Tier-1 LST additions (2)

#### **dzSOL** (DoubleZero LST) ⭐

| Field | Value |
|---|---|
| Class | LST |
| Mint | ⚠️ Verify in DoubleZero docs (launched mid-2025, 13.2M SOL staked per Sanctum 2026 ranking) |
| Intrinsic | Sanctum-style sol_per_lst if available; else DoubleZero protocol exchange rate via on-chain decode |
| Market | Jupiter quote with SOL numeraire (use SOL-denominated path) |
| Pyth feed | TBD (Pyth may have added dzSOL feed; verify) |
| Thresholds (bps) | drift=50, depeg=120, critical=280 |
| Active in Phase 0 | `false` |

**Why this matters**: 2nd largest Solana LST by SOL staked. Major competitor to jitoSOL/mSOL. Missing from Pegana coverage is a credibility gap.

#### **vSOL** (Validator-optimized LST, Sanctum Infinity pool member)

| Field | Value |
|---|---|
| Class | LST |
| Mint | ⚠️ Verify in Sanctum docs / research blog post |
| Intrinsic | Sanctum sol_per_lst (vSOL is in Sanctum Infinity pool) |
| Market | Jupiter quote SOL numeraire |
| Thresholds (bps) | drift=55, depeg=140, critical=300 (vSOL has more validator turnover by design, wider tolerance) |
| Active in Phase 0 | `false` |

**Why this matters**: validator-optimized = supports smaller/newer validators, important for Solana decentralization narrative. Sanctum-blessed.

### Total Phase 0 inventory: **5 new assets (3 stables + 2 LSTs)** in passive calibration

| Symbol | Class | Why now |
|---|---|---|
| **JupUSD** | StableDn | Jupiter native, strategic ecosystem play |
| **JLP** | StableYield (index-basket conservative) | Base of Kamino loops |
| **EURC** | StableFiat (EUR peg) | First non-USD asset, demonstrates breadth |
| **dzSOL** | LST | 2nd largest LST by SOL staked |
| **vSOL** | LST | Sanctum-integrated, validator-optimized |

---

## 4. Phase 14 additions (post-launch, new calibration cycle)

These 6 assets go to `assets.toml` `active=false` AFTER Trust Layer v0.1.0 ships (06-11), with their own 14-day calibration window starting then. Target activation: 2026-06-25 to 2026-07-15 depending on calibration verdict per asset.

### Stablecoin additions

#### **USDG** (Paxos consortium — Robinhood + Galaxy + Anchorage + Paxos)
- Mint: search at `docs.paxos.com/stablecoin/usdg/mainnet`
- Class: StableFiat
- Why: regulatory-compliant institutional stablecoin, MAS-regulated, growing fast

#### **USDPT** (Western Union via Anchorage Digital, launched 2026-05-04)
- Mint: search Western Union announcement
- Class: StableFiat
- Why: brand recognition + correspondent banking integration

#### **SoFiUSD** (SoFi — first US bank-issued stablecoin)
- Mint: search SoFi launch announcement
- Class: StableFiat
- Why: regulatory milestone (first US bank), institutional credibility flag

#### **AUSD** (Agora — T-Bill + repo backed)
- Mint: search `agora.finance` developer docs
- Class: StableYield (T-Bill yields)
- Why: RWA-backed, VanEck-linked, institutional credit angle

#### **BUIDL** (BlackRock USD Institutional Digital Liquidity Fund via Securitize)
- Mint: Securitize-managed wrapper on Solana (verify via Securitize Solana docs)
- Class: StableYield (tokenized T-Bill MMF)
- Why: institutional flag, but minimum investment is $5M (restricted). Pegana monitors for ecosystem context.

#### **OUSG** (Ondo Short-term US Government Treasuries — retail wrapper of BUIDL)
- Mint: confirm in `ondo.finance/ousg`
- Class: StableYield
- Why: retail entry to BUIDL with $5,000 minimum, much more accessible

### Total Phase 14 inventory: **6 new assets**.

---

## 5. Deferred indefinitely (validation gates not met)

These assets are tracked but NOT added until specific conditions trigger:

| Symbol | Class | Why deferred | Trigger to add |
|---|---|---|---|
| **ACRED** | StableYield (Apollo private credit) | Niche; thin secondary market on Solana | $100M+ TVL on Solana DEXs |
| **USYC** | StableYield (Hashnote MMF) | Niche institutional | $50M+ TVL Solana |
| **scrvUSD** | StableYield (Curve Savings) | Not yet launched on Solana | Curve announcement |
| **USD0/USD0++** | StableFiat / StableYield (Usual) | Bridge or native? Awaiting clarity | Native Solana mint exists |
| **xStocks** (TSLAx, AAPLx, SPYx) | NEW: `tokenized_equity` | Requires new asset class implementation in engine | $20M+ aggregate TVL + design feedback |
| **Sanctum partner LSTs**: cgntSOL, laineSOL, picoSOL, jucySOL, compassSOL, hSOL, HausSOL | LST | Smaller liquidity; long-tail | Each crosses 100K SOL staked individually |
| **Bybit LST (bnSOL)** | LST (exchange-backed) | Centralized issuer, complex risk profile | Sanctum integration confirmed |

### Permanently inactive

| Symbol | Status | Reason |
|---|---|---|
| **dSOL** (Drift LST) | `active=false`, kept in `assets.toml` for historical record | Drift exploit 2026-04-01; pool frozen, no longer trades |
| **BRZ** (Transfero Brazilian Real stable) | `active=false` | Jupiter routes broken (TOKEN_NOT_TRADABLE); insufficient liquidity for reliable market signal |

These appear in calibration history queries (`/v1/audit?asset=dSOL`) but never produce new alerts. Filtered out of `/v1/assets` list response per spec `09-web-pages.md § /audit index page`.

---

## 6. Asset count summary (ground truth from `assets.toml`)

| Phase | LSTs | Stables (fiat) | Stables (DN) | Stables (CDP) | Stables (yield) | Synthetic | Total active |
|---|---|---|---|---|---|---|---|
| **Today (22 active + 6 inactive: BRZ, JupUSD, EURC, dzSOL, vSOL, JLP)** | 8 (incl. INF) | 3 | 1 (USDe) | 2 (USDS, hyUSD) | 7 | 1 (xSOL) | **22 active / 28 entries** |
| **Phase 0 adds (committed inactive, calibrating)** | 2 (dzSOL, vSOL) | 1 (EURC) | 1 (JupUSD) | 0 | 1 (JLP) | 0 | already in the 28 entries |
| **At 06-11 launch (Phase 0 flipped active per ADR-0002)** | 10 | 4 | 2 | 2 | 8 | 1 | **27 active / 28 entries** (BRZ stays inactive) |
| **Phase 14 adds (post-launch)** | 0 | 3 (USDG, USDPT, SoFiUSD) | 0 | 0 | 3 (AUSD, BUIDL, OUSG) | 0 | +6 entries |
| **Post-Phase 14 if all activate** | 10 | 7 | 2 | 2 | 11 | 1 | **33 active / 34 entries** |

**LST/total active ratio post-Phase 14**: 10/33 ≈ 30%. LST-weighted in absolute terms (largest single class), but stables dominate by count.

**Notes**:
- INF is **active** (`assets.toml:64`) — counted in the 8 active LSTs above.
- BRZ stays inactive (Jupiter routes broken per memory).
- The 5 Phase 0 additions (JupUSD, JLP, EURC, dzSOL, vSOL) are already in the 28 entries as `active = false`; they flip to `active = true` at launch per ADR-0002. Until then they are counted as inactive.
- USDe (StableDn) and USDS (StableCdp) are already active in production — Phase 0 only changes the status of the 5 listed; nothing existing changes status during the calibration window.

---

## 7. Threshold calibration philosophy

Each asset's `thresholds_bps` (or `thresholds_cr` for hyUSD) is set per these rules:

1. **drift**: `p99 of |discount| × 1.25` over 14d passive observation. The 25% buffer absorbs natural noise without firing.
2. **depeg**: `~2× drift`, calibrated to the asset's class:
   - LSTs: depeg = 2.4× drift (LSTs have more recoverable drift)
   - Fiat stables: depeg = 3.3× drift (depeg is more meaningful, tighter)
   - Yield-bearing stables: depeg = 4× drift (NAV drift is natural, only discount-side matters)
3. **critical**: `~3× depeg`, asset-class dependent. Represents "this is a real cascade-risk event".
4. **black_swan** (hyUSD only): CR < 100% — undercollateralized.

These multipliers come from the existing 22 active assets' calibration history (see `docs/CALIBRATION-v1.md`). Phase 0 calibration data refines per-asset values for the 5 new entries (JupUSD, JLP, EURC, dzSOL, vSOL).

**Direction-sensitive logic**: Yield-bearing stables (`StableYield`) only alert on **discount** (`market < NAV`). Premium (`market > NAV`) is normalized to PEGGED. This is the `state_for_bps_discount_aware` path in the methodology. Source: `crates/methodology/src/thresholds.rs` (extracted from `engine-rs/src/thresholds.rs`).

---

## 8. Per-asset implementation status tracking

A live table at `/methodology#asset-status` (see `09-web-pages.md § /methodology`) shows for each asset:

- Symbol, mint, class
- Current state (PEGGED/DRIFT/DEPEG/CRITICAL/BLACK_SWAN/UNKNOWN)
- Latest `discount` value
- Last alert timestamp (if any)
- Methodology version that processed last alert
- Calibration status: `calibrating | live | inactive`

This table is built from `/v1/assets` + `/v1/audit?asset=...&limit=1` API responses; rendered with SWR 30s cache.

---

## 9. Cross-references

- For mint address validation procedure, see `plans/01-phase-0-preflight.md § Task 0.2`.
- For threshold calibration runner, see `plans/14-phase-14-15-post-launch.md § Backtest 10/10`.
- For engine-side asset class semantics, see `05-methodology-crate.md § thresholds module`.
- For how new assets appear on `/audit` index, see `09-web-pages.md § /audit`.
- For OG image rendering per asset, see `09-web-pages.md § opengraph-image.tsx`.
- For business rules on adding new asset classes, see `01-business-rules.md § 4. Scope of v0.1.0`.

---

## 10. Validation status

As of 2026-05-28, the following mint addresses still need verification before commit to `assets.toml`:

- [ ] **JupUSD** mint — search Jupiter launch announcement / Solscan
- [ ] **USDe** mint — confirm `DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT` is current
- [ ] **EURC** mint — search `developers.circle.com`
- [ ] **dzSOL** mint — search DoubleZero docs
- [ ] **vSOL** mint — search Sanctum Infinity pool list
- [ ] **JLP NAV feed** — confirm Pyth feed name `JLP/USD.NAV` exists
- [ ] **USDS Pyth feed** — confirm `USDS/USD` exists in Pyth catalog
- [ ] **JupUSD Pyth feed** — likely too new; may need Jupiter quote fallback

Each verification is a checkbox in `plans/01-phase-0-preflight.md § Task 0.2`. CI workflow `verify-assets` (existing) validates mints automatically on every push.
