# ADR 0015 — Calibration v1 verdict rule (per-class revision)

**Status**: Accepted (2026-05-29)
**Supersedes**: [ADR-0001](./0001-calibration-v1-verdict-rule.md)
**Context**: Trust Layer v0.1.0 launch gate

## Problem

ADR-0001 set the verdict rule as `≥80% of active assets observed ≥3 state transitions
in the window`. With 22 active assets at deploy time, that requires ≥18 assets with
≥3 transitions each.

Reality check against the first 7 days of dogfood data (2026-05-22 → 2026-05-28)
plus the trust-layer-deployed run (2026-05-29):

| Asset | Alerts in 7d |
|---|---:|
| USDT | 67 |
| PYUSD | 4 |
| pbUSDC | 3 |
| USDS, mSOL, sUSD, USDC | 2 each |
| Other 15 active assets | 0 |

Only 1 asset (USDT) had ≥3 transitions. At current trajectory, ≤3 assets will
hit ≥3 transitions in 13 days. The 18-asset bar is essentially impossible
without a market-wide stress event.

Three root causes:

1. **Class mismatch.** ADR-0001 treats all 22 active assets uniformly. But:
   - **stable_yield** (sHYUSD, USDY, sUSDe, syrupUSDC, sUSD, ONyc, pbUSDC) are
     NAV-based, peg-by-design via redemption — transitions are rare by design.
     A transition signals real redemption stress, not healthy calibration.
   - **synth_lev** (xSOL) is sole survivor in its class (Clone Protocol sunset,
     no Solana mainnet peer). Wide thresholds by design; 0 historical alerts.
   - **stable_fiat** (USDC, USDT, PYUSD) in calm markets stays well within
     the drift threshold — transitions are abnormal events.

2. **No liveness fallback.** ADR-0001 only counts transitions. An asset that
   stayed PEGGED the entire window with continuous fresh data is "uncalibrated"
   by the rule — even though that data IS the calibration signal.

3. **Default-deny is too aggressive.** ADR-0001 EXTEND triggers `<50%` — but
   the 80% main bar already wouldn't be met. The window would extend
   indefinitely without resolving the structural issue.

## Decision

Replace ADR-0001's single global rule with a **per-class verdict rule** with a
**hybrid transitions-OR-liveness criterion** per asset.

### Class taxonomy (at deploy time)

| Class | Members | Count | Verdict role |
|---|---|---:|---|
| **A — peg-watched** | 8 LST + 3 stable_fiat + 2 stable_cdp + 1 stable_dn | 14 | Counts in verdict |
| **B — yield-bearing** | stable_yield (sHYUSD, USDY, sUSDe, syrupUSDC, sUSD, ONyc, pbUSDC) | 7 | Counts in verdict |
| **C — monitoring-only** | synth_lev (xSOL) | 1 | Excluded; exhibited with `monitoring` badge |

### Hybrid per-asset criterion (applies to Class A and Class B)

An asset is **calibrated** if it satisfies EITHER of:

```
(i)  ≥3 state transitions in the window
     (proves the threshold is REACHABLE)

OR

(ii) ≥10 days with intrinsic AND market snapshots fresh (<6h between updates)
     AND p95 |discount_bps| < thresholds_bps.drift for that asset
     (proves the threshold is well-CALIBRATED on a calm asset)
```

### Verdict gate

```
SHIP if ALL of:

  Class A — ≥80% (= 12 of 14) calibrated per the hybrid criterion
  Class B — ≥80% (= 6 of 7) calibrated per the hybrid criterion

  Quality bars (cross-class):
    - ≤20% of transitions in each class classified as "false_positive" or "noisy"
      (manual labelling required during the window — daily ritual)
    - 5 critical assets (USDC, USDT, USDe, USDS, jitoSOL) have complete data
      (any one missing = NO-GO automatic, override-only)
    - Webhook delivery rate ≥99% AND p99 ≤5s
    - Zero unresolved "source_outage" labels in the daily notes

TUNE if:
    - ≥1 critical asset shows >40% noise
    - Action: threshold delta documented in crates/methodology/CHANGELOG.md;
      re-run 7 days with the new threshold

EXTEND DOGFOOD if:
    - <50% of either Class A or Class B satisfies the hybrid criterion
      (interpretation: market too calm AND data too sparse — needs more runway)
    - Action: +14 days

DOWNGRADE asset to monitoring-only if:
    - Asset fails BOTH criteria but yields ≥7 days of data
    - Action: move out of verdict denominator; exhibit with `monitoring` badge;
      annotate in assets.toml with `# monitoring-only per ADR-0015 on YYYY-MM-DD`
```

### Window

- **Start**: 2026-05-29 03:55 UTC (Trust Layer dogfood deploy; matches `EVIDENCE
  LIVE FROM` marker in CALIBRATION-v1.md)
- **End**: 2026-06-10 23:59 UTC
- **Effective duration**: 12 days 20 hours

### Rule revision cutoff

This ADR can be revised until **2026-06-09 23:59 UTC**. Any revision after that
is locked in to avoid post-hoc bias. The mechanical verdict is computed against
the rule as locked at the cutoff.

### Manual override

Override by Rafael is permitted but must be documented in the calibration report
with a written reason (e.g., "Class B at 5/7 = 71%, but ONyc failed only on
account-read sluggishness during the launch-week US bank holiday — not a
methodology fault; override to SHIP"). Default is the mechanical outcome.

## Why this and not (alternatives)

1. **Per-class denominator (not aggregate 80% of 21)** — different classes
   have fundamentally different calibration signals; an aggregate bar would
   let Class B drag Class A or vice versa. Per-class gates force both
   methodologies to clear independently.

2. **Hybrid (not transitions-only or liveness-only)** — transitions-only
   recreates ADR-0001's failure mode. Liveness-only fails to validate that
   thresholds are REACHABLE (the original concern). Hybrid captures both
   validation paths.

3. **p95 (not p99 or p50)** — p99 is too strict (a single noisy day kills
   an otherwise clean asset). p50 is too loose (an asset spending 49% in
   DRIFT would pass). p95 accepts ~5% real-world noise without licensing
   miscalibrated thresholds.

4. **`drift` threshold (not `depeg`)** — using `depeg` would mean "asset
   spent most of the window in DRIFT but never DEPEG" counts as calibrated;
   that's the threshold being too loose, not the asset being healthy. The
   bar is "asset stayed PEGGED" which uses the `drift` line.

5. **<6h fresh** — matches Pyth Redemption Rate publish cadence (daily for
   most issuer feeds) with comfortable margin. Tighter (e.g., <1h) would
   penalize NAV feeds that legitimately publish slower.

## Consequences

- **Per-class structure forces 2 independent gates.** A perfect Class A
  with a broken Class B still blocks SHIP — but the DOWNGRADE path provides
  a safety valve for individual stuck assets.

- **Liveness fallback removes the "calm market = no-launch" trap.** Calm
  asset + healthy data + p95 within drift = calibrated. Honest signal.

- **Daily labelling work is unchanged from ADR-0001.** Still ~15 min/day
  (manual transition classification). The daily watch cron
  (`scripts/calibration-watch.sh`) now also surfaces per-class calibration
  status, not just commit health.

- **Monitoring-only assets need UI affordance.** `/audit` and the asset table
  must visually distinguish `monitoring` assets from `calibrated` assets so
  the public knows which carry the launch verdict and which don't.

- **xSOL stays in v0.1.0** with `monitoring` badge — Pegana covers the only
  synth_lev primitive on Solana mainnet, with honest disclaimer that
  threshold validation awaits a real event.

## Tactical pre-check (2026-05-29)

Liveness data check at 04:53 UTC: all 7 Class B assets had 1440-2880
snapshots in the last 24h, last update <1 min ago. Class B at minimal risk.

Class A liveness depends on Jupiter + Pyth feed continuity; both have been
stable in prod. Risk concentrated in: did USDT keep flapping (transitions
path) AND did the other 13 keep fresh data (liveness path).

## Cross-refs

- `docs/CALIBRATION-v1.md` (where measurements land — table structure now
  reflects per-class)
- `docs/pegana-trust-layer-v0.1.0/01-business-rules.md § 5` (deploy gate)
- `docs/pegana-trust-layer-v0.1.0/AMENDMENTS.md` (this ADR replaces 0001 in
  the index)
- ADR-0002 (per-asset activation rule — orthogonal; deferred assets are
  separate from monitoring-only)
- ADR-0005 (early evidence rollout — defines window start)
