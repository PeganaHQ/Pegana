# USD+ (Streamflow) — pending external launch

> Recorded 2026-05-29. Tracking USD+ as a candidate, but the asset is
> NOT addable until Streamflow ships full mainnet deployment.

## Status (2026-05-29 research)

Streamflow announced USD+ on 2025-12-24 with a waitlist. As of today:

- Marketing page (`https://usd-plus.com/`) shows "USDC swaps available
  now" but flags "Use in DeFi (Soon)" and "Support for USDT, fiat, and
  others is coming soon."
- No public mint address disclosed via `streamflow.finance` or
  `usd-plus.com`.
- No Pyth feed for USD+ on `hermes.pyth.network` as of query date.
- Powered by M0's universal stablecoin platform (M0 itself has a Solana
  presence — token `M` at $15M circulating).

## Why we can't add yet

Pegana asset integration requires:

1. **Verified Solana mainnet mint address** — needed for indexer + audit
   trail. Cannot be `?`.
2. **Intrinsic value source** — either `fixed_1_usd` (if USDC-backed
   redeem-at-par) OR a published NAV oracle (Pyth RR or on-chain account).
3. **Market reading path** — Jupiter route + numeraire feed, OR a
   reliable DEX quote source.
4. **Threshold calibration** — at minimum, a few days of historical
   discount data to defend the drift band.

None of the four are available without Streamflow shipping mainnet first.

## Re-evaluation triggers

Re-open this when ANY of:

1. Streamflow publishes the USD+ mint on their docs page.
2. Pyth lists a `USD+/USD` or `USD+/USD.RR` feed.
3. M0 confirms a Solana M-token mint + redemption path that USD+ would
   inherit.
4. A user explicitly requests USD+ coverage (signal of integration demand).

When any trigger fires:

- Add the entry to `assets.toml` with `active = false` and 14-day
  calibration window per ADR-0002.
- Document the intrinsic strategy (likely a new `m0_redemption` kind
  if M0 publishes their oracle, OR `fixed_1_usd` if USDC-redeem-at-par).
- Update `03-asset-coverage.md` to remove the "deferred" note.

## Today's posture

Comment on `assets.toml:1` and `assets.toml:469-472` already documents
USD+ as deferred. No code change needed. This memo formalizes the
research state so the next session doesn't repeat the lookup.
