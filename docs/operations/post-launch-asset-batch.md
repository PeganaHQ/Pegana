# Post-launch asset expansion batch — research log

> Recorded 2026-05-29. Six asset candidates with confirmed Pyth feeds
> and >$1M Solana circulating, deferred to post-launch (≥ 2026-06-18)
> for safety: each requires mint + full Pyth feed ID + decimals
> verification we couldn't complete in the same session as the launch
> sprint.

## Coverage gap context

DefiLlama snapshot 2026-05-29: **32 stablecoins** with >$1M circulating
on Solana. Pegana covers 10 of those today (USDC, USDT, PYUSD, USDe,
USDS, JupUSD, USDY, hyUSD, sUSD, sHYUSD); the remaining 22 represent
~$4B+ in liquidity NOT under peg-risk monitoring.

The gap matters because every uncovered major stable is a customer
asking "why doesn't Pegana watch X" that we can't answer well.

## Candidates with Pyth feed verified

Six candidates verified to have a Pyth feed via
`hermes.pyth.network/v2/price_feeds?query=<symbol>` 2026-05-29:

| Symbol | Solana circulating | Peg mechanism | Pyth feeds | Adapter |
|---|---|---|---|---|
| USD1 | $991M | fiat-backed (WLFI) | `Crypto.USD1/USD` (spot) | `fixed_1_usd` + `jupiter_usd` (likely USDC numéraire) |
| USDG | $686M | fiat-backed (Paxos/Global Dollar) | `Crypto.USDG/USD` (spot) | `fixed_1_usd` + `jupiter_usd` |
| USX | $501M | crypto-backed (Solstice) | `Crypto.NAV.USX/USD` (NAV) + `Crypto.USX/USD` (spot) + `Crypto.EUSX/USX.RR` | yield-bearing — `pyth_redemption_rate` |
| CASH | $116M | (unknown — needs research) | `Crypto.CASH/RD.RR` (RR) + `Crypto.CASH/USD` (spot) | yield-bearing — `pyth_redemption_rate` |
| USDTB | $43M | delta-neutral (Ethena USDtb) | `Crypto.USDTB/USD` (spot) | similar to USDe — `fixed_1_usd` |
| FDUSD | $8.5M | fiat-backed (First Digital) | `Crypto.FDUSD/USD` (spot) | `fixed_1_usd` + `jupiter_usd` |

Combined Solana circulating: **~$2.35B** — would roughly double
Pegana's coverage by liquidity-weighted exposure.

## Candidates WITHOUT Pyth feed (need alternative market source)

Confirmed via the same query:

| Symbol | Solana circ. | Note |
|---|---|---|
| BUIDL | $617M | BlackRock T-bill fund — DexScreener fallback possible (Raydium has BUIDL/USDC) |
| USDGO | $323M | No Pyth feed; need DexScreener or direct issuer oracle |
| YLDS | $285M | Yield-bearing; same issue |
| MOVEUSD | $114M | Same issue |
| M | $15M | M0 protocol token; new |

These require either (a) issuer-published oracle or (b) DexScreener
single-source pattern (same as ONyc/pbUSDC). DexScreener single-source
is on the H7 hardening list — should be addressed in P1 batch BEFORE
adding more DexScreener-dependent assets.

## Why deferred to post-launch

1. **Each candidate needs full metadata**: mint address (verified via
   mainnet RPC `getAccountInfo`), decimals, `token_program` (spl vs
   token-2022), full hex Pyth feed ID. The session that surfaced these
   candidates ran late and the external endpoints (Jupiter token list,
   Solscan top-200) were intermittent.

2. **Calibration window is open**: ADR-0002 calibrates per-asset over
   14 days. Adding mid-window means assets enter calibration LATE and
   may not have enough data for the verdict gate at 06-10. Either
   (a) accept they enter calibration day 1 of next window, or (b) flip
   active=true at launch and live-calibrate post-06-11.

3. **Disciplined order of operations**: H1-H12 hardening list
   includes "DexScreener single-source for 3 assets". Adding more
   DexScreener-dependent assets BEFORE that fix compounds the risk
   surface.

4. **Methodology bump implication**: per ADR-0009, adding new assets
   between launch and stability-lock-end (06-25) requires either a
   methodology PATCH bump (batched weekly) or wait for the cycle.

## Action plan

| When | Action |
|---|---|
| Pré-launch (now) | This memo + JLP added (separate doc). |
| 2026-06-11 launch | Flip JupUSD + EURC + dzSOL + vSOL + JLP to `active=true` per ADR-0002 calibration verdict. |
| 2026-06-18 (7d post-launch stable) | Confirm prod stability + revisit H1-H12 hardening priorities. |
| 2026-06-25 (post stability-lock) | Phase 0c batch addition: USD1, USDG, USDTB, FDUSD with `fixed_1_usd` (lower risk path first). |
| 2026-07-01+ | Phase 0d batch: USX, CASH (yield-bearing, require RR feed wiring). |
| 2026-07-15+ | Phase 0e: BUIDL via DexScreener (only after H7 fix lands a multi-source failover). |

## Open questions for next sprint

1. Is `Crypto.NAV.USX/USD` the canonical NAV for USX, or does the
   `Crypto.EUSX/USX.RR` (Earn USX vs base USX redemption rate) play
   a role? Affects intrinsic strategy.
2. CASH peg mechanism (fiat? crypto? algorithmic?) is unknown from
   DefiLlama data — needs issuer doc lookup before classification.
3. M0 / M token relationship — is M the same as M0 or different?
   USDTB is "Ethena USDtb" backed by M0/BUIDL; understanding the
   trust chain affects intrinsic strategy for USDTB.

## Threshold guidance

For Phase 0c (fiat-backed adds):
- USD1, USDG, USDTB, FDUSD: start with USDC pattern `drift=15, depeg=50, critical=200` and tighten after calibration if behavior is unusually quiet.

For Phase 0d (yield-bearing):
- USX, CASH: start with USDY pattern `drift=30, depeg=100, critical=250` and calibrate against per-asset p99.

For Phase 0e (DEX-quote single-source):
- BUIDL: defer until H7 (DexScreener multi-source) lands; if added before, thresholds should be wider per ONyc precedent `drift=275, depeg=500, critical=800`.
