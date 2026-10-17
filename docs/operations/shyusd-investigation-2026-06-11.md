# sHYUSD investigation — 2026-06-11

Status: monitoring-only, do not promote until the source semantics are
confirmed.

## Finding

Production is not missing an alert because of an engine persistence bug.
sHYUSD is `stable_yield`, and Pegana's methodology intentionally normalizes
premium-side spreads to `PEGGED` for `stable_yield` assets. A negative discount
means `market > intrinsic`; for this class, only `market < NAV/intrinsic` is
treated as redemption stress.

Live production sample on 2026-06-11 13:13 UTC:

| field | value |
|---|---:|
| state | `PEGGED` |
| ewma discount | `-0.2666` |
| intrinsic | `$1.0280` |
| market | `$1.3021` |
| route | `Meteora DLMM` |
| price impact | `0.000780` |
| alerts in 24h | `0` |

The last 24h were all `PEGGED` for sHYUSD, with smooth discount between
`-2686.01 bps` and `-2329.24 bps`.

## Interpretation

The red flag remains real, but it is not an UNKNOWN-gate or false-confirm in
the transition engine. It is a source-semantics issue:

- Intrinsic source `hylo_shyusd_rate` reports roughly `$1.028`.
- Market source `jupiter_usd` routes through Meteora DLMM around `$1.302`.
- The methodology treats that as a premium and therefore safe from an alerting
  perspective.

Before promotion, verify whether sHYUSD intrinsic should include additional
Stability Pool assets/rewards beyond `pool_hyusd_balance / shyusd_supply`, or
whether the market route is structurally pricing accrued future yield.

## Next Action

Keep sHYUSD `monitoring_only=true`. Re-check Hylo source math against protocol
docs or on-chain account layout before moving it back into the calibrated
denominator.
