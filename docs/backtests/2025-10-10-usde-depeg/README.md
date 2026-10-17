# 2025-10-10 USDe cascade backtest

## What happened

On 2025-10-10, a market-wide deleveraging event liquidated more than $19 billion of leveraged positions within 24 hours. The most concentrated damage occurred around 21:00 UTC. Pyth's one-minute USDE/USD candle reached a $0.95331862 low at 21:29 UTC (about 467 bps below peg), while the conservative candle close used by this replay bottomed at $0.95923086. SOL fell to roughly $170–$174 during the event.

This backtest replays the captured Pyth series through the unmodified Pegana methodology 0.4.0. It classifies peg risk; it is not a PnL simulation.

Sources: [CoinGecko event analysis](https://www.coingecko.com/learn/october-10-crypto-crash-explained), [CoinDesk market review](https://www.coindesk.com/research/market-spotlight-the-19-billion-liquidation-that-shook-crypto).

## What Pegana would have detected

time_to_first_alert_secs is measured from the fixture start, 2025-10-09 00:00:00 UTC.

| Asset | Fidelity | Maximum state | First alert (seconds) |
|---|---|---:|---:|
| INF | doubly-proxied | DRIFT | 164700 |
| PYUSD | market-proxied | DEPEG | 164340 |
| USDC | perfect | PEGGED | — |
| USDS | market-proxied | DRIFT | 63420 |
| USDT | perfect | DEPEG | 164040 |
| USDe | market-proxied | CRITICAL | 163380 |
| bSOL | doubly-proxied | DEPEG | 163920 |
| jitoSOL | doubly-proxied | CRITICAL | 163800 |
| mSOL | doubly-proxied | CRITICAL | 163560 |
| sUSDe | perfect | PEGGED | — |

USDC and sUSDe stayed PEGGED. USDT did not: its Pyth series remained above $1 and reached a $1.00704549 premium. Methodology 0.4.0 treats stable_fiat deviations symmetrically, so that sustained premium produced DEPEG. This is a real disagreement with the original “USDT held” design assumption, not a downward depeg or a modified backtest rule.

## Fidelity

| Tier | Assets | Intrinsic path | Market path | Claim strength |
|---|---|---|---|---|
| Perfect | USDC, USDT, sUSDe | Same fixed-$1 or Pyth redemption-rate input as live | Same Pyth spot feed as live | Rigorous |
| Market-proxied | USDe, PYUSD, USDS | Same fixed-$1 intrinsic | Pyth spot instead of executable Jupiter quote | Conservative lower bound |
| Doubly-proxied | jitoSOL, mSOL, bSOL, INF | Pyth LST/SOL redemption rate instead of live Sanctum NAV | Pyth LST/USD divided by SOL/USD instead of executable Jupiter quote | Directional |

During a crash, an executable Jupiter quote can include more slippage than the Pyth mid. The market-proxied result therefore tends to understate a live discount: firing on the mid is a conservative lower-bound signal. The LST results have two proxy legs and should be read as directional rather than exact.

## Data and tolerance

- Source: Pyth Benchmarks TradingView shim, one-minute resolution.
- Window: 2025-10-09 00:00:00 UTC through 2025-10-12 00:00:00 UTC.
- Each of the 10 series contains 4,321 ticks. The fixture is 8.80 MB.
- The runner uses candle closes. The raw Pyth candle low is reported only as event context.
- DefiLlama reported USDe at $0.95348561 near the Pyth trough, 1.67 bps above Pyth's $0.95331862 candle low.
- CoinGecko's hourly range series reported $0.99665672; its coarse sampling missed the minute-level dislocation by 433.38 bps relative to the Pyth candle low.
- Pyth Hermes confidence is display-only and is not part of rederive; this fixture does not synthesize historical confidence labels.

The committed fixture, rather than either cross-check API, is the deterministic input to CI.

## Verify

Build or install the public CLI, then verify any emitted schema-v2 receipt:

    pegana-replay --bundle docs/backtests/2025-10-10-usde-depeg/receipts/USDe-001.json

The receipt pins methodology 0.4.0, the canonical asset snapshot, the frozen inputs, the computed transition, and its SHA-256 hash. Regenerate or check the complete case with:

    scripts/run-backtest.sh 2025-10-10-usde-depeg check

## Disclaimer

Hypothetical backtest against real historical Pyth data. No live alert was emitted on this date. Methodology v0.4.0, unmodified.

Compare this replay with the live [USDe audit page](/audit?asset=USDe) or open the [web backtest](/backtest/2025-10-10-usde-depeg).
