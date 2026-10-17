# xBTC (Hylo) — groundwork + blocker tracking (2026-07-23)

> **Decision: DEFER.** Founder asked to add Hylo's new **xBTC** token. Research
> (this doc) shows it is **not addable honestly yet** — blocked on Hylo publishing
> the V2 mint+addresses AND on building a new indexer decoder for the V2 multi-asset
> BTC pool. This doc captures everything a future session needs to unblock it fast.
> **Nothing added to the universe.** No `assets.toml` entry, no migration.

---

## 1. What xBTC is (researched 2026-07-23 — docs.hylo.so + on-chain + press)

xBTC is Hylo's new **leveraged-bitcoin** token — the **BTC analog of xSOL**. It's the
risk-bearing side of a split-risk BTC market: deposited **cbBTC** backs the hyUSD
stablecoin first (as `vUSD_BTC`), leaving xBTC holders the amplified exposure that
remains → **2×–4× long BTC** (currently ~2.7×), no perps, no funding, no liquidation
price (leverage floats with the pool's collateral ratio).

- Part of **Hylo V2** (multi-asset collateral — SOL via LSTs, BTC via cbBTC, plus a
  USDC pool). V2 uses **independent collateral pools per asset**, each split into an
  `xASSET` + its `vUSD`. hyUSD is backed 1:1 by Σ(all vUSD).
- **Timeline:** mint deployed **2026-07-13**, public market opened **2026-07-20**.
  Day-1: supply 0 → ~24.8K xBTC (~$29K at ~$1.17 NAV), 72 holders, ~1.19 cbBTC
  (~$77K) in the vault.
- **cost vs xSOL:** xBTC charges a **configurable borrow rate** (paid by holders via
  NAV reduction) because BTC has no native yield — xSOL's leverage is ~free (SOL
  staking rewards accrue to the protocol). Same pricing mechanism otherwise.

**NAV / intrinsic formula (Hylo V2 equations doc):**
```
xBTC NAV_usd = (BTC_TVL_usd − vUSD_BTC_supply) / xBTC_supply      (defaults to $1 if xBTC_supply = 0)
  where BTC_TVL_usd = cbBTC_reserves × BTC/USD (Pyth)
```
This is the same shape as the existing xSOL NAV in `hylo.rs`
(`(total_sol × sol_usd − hyusd_supply × hyusd_nav) / xsol_supply`) but sourced from a
**separate BTC pool**, not the SOL exchange's `total_sol_cache`.

---

## 2. Blockers (why DEFER)

### B1 — Official mint = `[TBD]` (not published)
`docs.hylo.so/security/onchain-addresses.md` lists xSOL/hyUSD/eHYUSD/hyloSOL/
hyloSOL+/cbBTC mints + the "Exchange v0.1" / "Stability Pool v0.1" programs, but
**xBTC is marked `[TBD]`** and **no BTC-market program/vault account is listed**.
The mint exists on-chain (market is live) but Hylo hasn't published it. Pegana's
whole thesis is verifiability — adding a scraped, officially-unpublished mint is
against that. **Wait for Hylo to publish it** (then `verify-assets` confirms it).

### B2 — Needs a NEW indexer decoder (V2 multi-asset BTC pool)
The current `crates/indexer-rs/src/sources/hylo.rs` reads **only the V1 SOL exchange**
(`HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn`, "Exchange v0.1", `total_sol_cache`
at fixed offset 304) and computes hyUSD/xSOL/sHYUSD — its header comment explicitly
says hyloSOL/hyloSOL+ (and by extension a BTC pool) are separate and NOT covered.
Adding xBTC requires:
- The **V2 program ID + BTC-pool account layout** (cbBTC reserves + `vUSD_BTC`
  supply). **Not published** — the doc still lists only "Exchange v0.1". Reverse-
  engineering a days-old, undocumented V2 account (like the offset-304 work for V1)
  is high-risk and can't be done reliably until Hylo publishes the IDL/addresses.
- A **BTC/USD Pyth numéraire** — **not currently configured**. Verified 2026-07-23:
  the only `BTC/USD` reference in the tree is a `state.rs:197` test asserting the
  cache returns `None`. Adding it is a code change in `crates/indexer-rs/src/sources/pyth.rs`.
- A new `intrinsic` kind (e.g. `hylo_xbtc_nav`) + the NAV computation, mirroring the
  xSOL branch but reading the BTC pool.

This is **real Rust indexer engineering** (a source feature + tests + golden), **not**
the config-only `assets.toml`+migration the original handoff assumed.

### B3 — Market leg is dust-thin + launch-concentrated
Day-1: ~$29K supply, **top-10 wallets hold 82%**, ~7h of history, minted directly
with cbBTC (~no secondary depth). This is exactly the **thin-Jupiter garbage-print →
false PEGGED** failure class that **HARD-BLOCKED sHYUSD**. Even with a working
intrinsic, the market leg would need a real liquidity/depth gate before it could be
trusted (and it would enter **beta + UNKNOWN-honest**, never calibrated, by design —
like xSOL, Class C).

---

## 3. Known addresses (for when it unblocks)

| Thing | Address | Status |
|---|---|---|
| xBTC mint | `[TBD]` | **unpublished** (B1) |
| cbBTC (collateral) | `cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij` | published |
| Hylo Exchange v0.1 (SOL/V1) | `HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn` | published (V1 only) |
| Hylo Stability Pool v0.1 | `HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ` | published |
| Hylo V2 program / BTC pool | — | **not listed** (B2) |
| xSOL mint (analog template) | `4sWNB8zGWHkh6UnmwiEtzNxL4XrN7uK9tosbESbJFfVs` | published |

---

## 4. Re-visit trigger + implementation checklist (when B1/B2 clear)

**Unblock when:** Hylo publishes (a) the xBTC mint and (b) the V2 program ID + BTC-pool
account layout / IDL on `docs.hylo.so/security/onchain-addresses.md` +
`.../developer-resources.md`. Re-check that page + ping Hylo if needed.

Then, as a proper indexer feature (its own branch + gate + golden):
1. `sources/pyth.rs` — add the **BTC/USD** feed to the numéraire cache.
2. `sources/hylo.rs` (or a new `hylo_btc.rs`) — decode the V2 **BTC pool** account
   (cbBTC reserves + `vUSD_BTC` supply) with a discriminator + offset walk from the
   published IDL (mirror the V1 `decode_hylo_total_sol` + its unit tests + the
   `ufix_to_decimal` / checked-math F-12 guards).
3. New intrinsic kind `hylo_xbtc_nav` = `(cbBTC_reserves × BTC/USD − vUSD_BTC) / xBTC_supply`.
4. `assets.toml` — add xBTC: `class = "synth_lev"`, `peg_target = NAV`, `intrinsic =
   { kind = "hylo_xbtc_nav" }`, `market = { kind = "jupiter_usd", numeraire = "BTC",
   numeraire_feed = "BTC/USD" }` (confirm the route exists + has depth), `active = true`,
   **`metadata.monitoring_only = true`** (beta by design — Class C, like xSOL).
5. Migration — INSERT the asset (mirror mig 0053/0064).
6. `cargo run -q -p xtask -- verify-assets` (confirms the mint on-chain) + **golden
   byte-exact** (a new asset must not change existing receipt hashes — confirm).
7. Enters **beta + UNKNOWN-honest** until it has a liquid market leg + a calibration
   window. **Do not promise calibrated.**

---

## 5. Sources
- Hylo docs: `docs.hylo.so/security/onchain-addresses.md` (mints/programs; xBTC=TBD),
  `.../technical-addendum/hylo-equations.md` (V2 NAV), `.../protocol-overview/
  multi-asset-architecture.md` (independent pools), `.../protocol-overview/xassets.md`
  (pricing/leverage), `.../product-guide/xassets.md`.
- Press: Pine Analytics (xBTC launch metrics, 2026-07-20); KuCoin / CryptoBriefing
  (Hylo V2 multi-asset launch); Messari / Solana Compass (protocol profile).
- Code: `crates/indexer-rs/src/sources/hylo.rs` (V1 SOL exchange; xSOL NAV template),
  `crates/indexer-rs/src/sources/pyth.rs` (numéraire feeds), `state.rs:197`
  (BTC/USD not configured).
