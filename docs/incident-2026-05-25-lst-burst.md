# Incident — 2026-05-25 LST simultaneous-drift burst

**Status:** resolved
**Severity:** high (signal correctness)
**Detected:** 2026-05-25 23:09:41 UTC
**Resolved:** 2026-05-26 00:52 UTC (HTML deploy)
**Author:** Rafael

## Summary

Six LSTs (JupSOL, hyloSOL, mSOL, bbSOL, bSOL, dSOL) transitioned
`PEGGED → DRIFT` within a 23 ms window, all with negative spreads of
similar magnitude (-0.59% to -0.78%). All six recovered to `PEGGED`
about 15 minutes later. The Telegram alerts were correctly delivered
but the signal was a false positive — none of these LSTs decoupled
from their underlying in SOL terms.

A separate, older bug was uncovered in the investigation: two alert
deliveries on 2026-05-25 14:13-14:14 UTC (`sUSD` DEPEG, `pbUSDC` DRIFT)
had failed silently with a MarkdownV2 escape error and were never seen
by the user.

## Impact

- 6 spurious Telegram alerts inside ~25 ms (all delivered).
- 2 historical alerts dropped silently (delivery failed, no user signal).
- Trust hit: every burst makes the product look noisy.

No financial impact (the product is informational, not transactional).

## Root cause 1 — multiplier race for LST discount

LSTs price in two places:

| Side | Source | Formula |
|---|---|---|
| Intrinsic | Sanctum extra-api, 15 s cadence | `sol_per_lst × pyth(SOL/USD)` |
| Market | Jupiter quote, ~16 s/asset round-robin | `lst_per_sol × pyth(SOL/USD)` |

Both sides read `state.pyth["SOL/USD"]`, which Hermes updates at ~1 Hz.
The engine consumed pre-multiplied USD values:

```
discount = 1 - market_usd / intrinsic_usd
         = 1 - (lst_per_sol × P_sol(t_jup)) / (sol_per_lst × P_sol(t_san))
```

In the ideal case `P_sol(t_jup) = P_sol(t_san)` and the multiplier
cancels. In reality the two sides captured different SOL/USD ticks,
typically 1–15 s apart. When SOL spot moved ~0.7% between those ticks,
**every LST simultaneously appeared to drift by the same delta** —
because every LST shares the same `pyth(SOL/USD)` term.

Sanity check via the discount snapshots around the burst confirms:

```
23:09:41 — six LSTs flip to DRIFT, deltas 0.59%–0.78%, same sign
23:24:11 — JupSOL, bbSOL, bSOL recover to PEGGED
23:24:41 — hyloSOL, dSOL recover
23:25:26 — mSOL recovers
```

The 15-minute gap matches the Sanctum poll cadence: as soon as Sanctum
republished `value_usd` with a fresher SOL/USD tick, the apparent drift
evaporated. This is the fingerprint of a multiplier race, not a real
market event.

## Root cause 2 — MarkdownV2 escape rejection

The bot rendered alerts in MarkdownV2 parse mode. The `alert_yield`
template injects a footer block inside italic (`_..._`) containing the
string "Yield-bearing — NAV grows over time…". The hyphen in
"Yield-bearing" is MarkdownV2-reserved and must be escaped with a
backslash.

`escapeMd` did escape hyphens correctly at the time of the failure,
but Telegram's parser rejected the message anyway with:

```
400: Bad Request: can't parse entities:
Character '-' is reserved and must be escaped with the preceding '\'
```

The dispatcher caught the HTTP 500 from the bot, persisted
`alert_deliveries.status='failed'` with the error string, and exited.
**There was no user-visible signal that any alert had been dropped.**

MarkdownV2 has 18 reserved characters. Escaping all of them perfectly
inside a templated string is a recurring footgun. HTML parse mode has
3 reserved characters (`<>&`), which is small enough to escape with
certainty.

## Detection

The user (operator, dogfood mode) noticed:

1. Six LST alerts arriving simultaneously felt physically implausible
   for genuinely independent decoupling events.
2. The Telegram bot did not always send notifications they expected
   to receive.

Both observations turned out to be different bugs.

## Resolution

Seven coordinated fixes (one commit, all in service of this incident
plus a few adjacent issues found during investigation):

| # | Fix | Reason |
|---|---|---|
| 1 | Bot `/send` → `parse_mode: HTML`, render template in HTML | Eliminates the MarkdownV2 escape footgun class. |
| 2 | Dispatcher dedup key includes severity bucket (`pegged`/`drift`/`depeg`/`critical`) | DRIFT → DEPEG within 1 h no longer collides on the same dedup key. Escalations and recoveries reach the user. |
| 3 | `[pyth_staleness]` per-feed override in `assets.toml` | NAV / redemption-rate feeds (USDY/USD, SUSDE/USDE.RR, SYRUPUSDC/USDC.RR, ONYC/USD.NAV) step at daily/weekly cadence. The previous 30 s global cap was rejecting them permanently. |
| 4 | LST discount computed in SOL terms when both sides publish a SOL value | This incident's actual root cause. Discount in SOL terms makes `pyth(SOL/USD)` cancel symbolically, not by coincidence. |
| 5 | `/v1/stats` exposes `delivery_health` (`sent_24h`, `failed_24h`, `last_failure_error`); dashboard renders a banner when `failed_24h > 0` | Silent failures become visible. The two historical failures surfaced immediately. |
| 6 | Engine emits a "cold start" alert when its first observed state for an asset is non-PEGGED | Closes the gap where a restart while an asset was already drifting would never fire. |
| 7 | `state_for_bps_discount_aware`: yield-bearing class is direction-sensitive (premium → PEGGED, only real discount triggers) | Premium on a yield-bearing wrapper is just thin secondary liquidity, not redemption stress. |

Regression tests:

- `lst_discount_in_sol_terms_ignores_sol_usd_multiplier_drift`
  reproduces the burst pattern (different SOL/USD snapshots, identical
  `sol_per_lst`) and asserts the SOL path reads zero.
- `dedup_key_includes_severity_bucket` /
  `dedup_key_recovery_is_distinct_from_alarm` assert escalations and
  recoveries are not silenced.
- `renderAlertTemplate` HTML suite asserts that hyphens, plus signs,
  underscores, slashes, and dots all survive without backslash escapes.

## Verification

After the deploy at 2026-05-26 00:52 UTC:

- `pbUSDC PEGGED → DRIFT` at 00:53:20 — delivery `status=sent`, no
  Telegram parse error.
- No failed deliveries since the deploy (`fails_since_html_deploy = 0`).
- `/v1/stats.delivery_health.failed_24h = 2` correctly surfaces the two
  pre-fix historical failures; they age out of the 24 h window naturally
  around 2026-05-26 14:13 UTC.

## Lessons

1. **Cancel multipliers symbolically, not by coincidence.** Whenever a
   downstream computes a ratio of two quantities that share a
   multiplier, push the cancellation up to the source so the engine
   never sees the multiplied form. If you can't, every snapshot skew
   becomes signal.
2. **HTML beats MarkdownV2 for templated message rendering.** Fewer
   reserved characters means fewer chances for a content change to
   break delivery. The cost of going wrong with MarkdownV2 is silent
   rejection.
3. **Dedup keys should encode the meaning of the alert, not just the
   subject.** Same asset, different severity = different message; the
   dedup key has to know that.
4. **Per-feed staleness windows.** Treating a daily-NAV feed with the
   same staleness gate as a 1 Hz spot feed is a category error.
5. **Surface delivery failures.** Two silent failures in 24 h was
   exactly the right number to expose the design gap: low enough to
   miss, high enough to matter. The banner is the cheapest possible
   fix to the silent-class problem.

## References

- Commit: `fix(backend): incident response — LST multiplier race + delivery class hardening`
- Code path: `crates/engine-rs/src/main.rs:try_recompute`
- Code path: `crates/dispatcher-rs/src/dedup.rs:dedup_key`
- Code path: `bot-ts/src/helpers.ts:renderAlertTemplate`
- Code path: `crates/api-rs/src/routes/stats.rs:summary`
