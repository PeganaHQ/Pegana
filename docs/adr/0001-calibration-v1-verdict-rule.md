# ADR 0001 — Calibration v1 verdict rule

**Status**: Superseded by [ADR-0015](./0015-calibration-v1-per-class-verdict.md) (2026-05-29)
**Context**: Trust Layer v0.1.0 launch gate

> ⚠️ **SUPERSEDED.** The single global rule `≥80% of active assets observed ≥3
> state transitions` failed the reality check against actual dogfood data —
> only 1 asset (USDT) had ≥3 transitions in 7 days; 15 of 22 had zero. The bar
> was structurally unreachable without market stress. ADR-0015 replaces this
> with per-class hybrid criteria (transitions OR liveness within threshold).
> Original text preserved below for historical context.

---

## Problem

The launch gate in `pegana-trust-layer-v0.1.0/01-business-rules.md § 5` defines
`verdict = "ship"` as the first required check — circular without a mechanical
rule mapping measurements → verdict. `CALIBRATION-v1.md` leaves all per-asset
numbers as `TBD`.

## Decision

The 2026-06-10 launch verdict is computed mechanically from the dogfood window
data using this rule:

```
SHIP if ALL of:
  - ≥80% of active assets observed ≥3 state transitions in the window
    (sign that the threshold is reachable, not dormant)
  - ≤20% of transitions classified as "false_positive" or "noisy"
    (manual labelling required during the window)
  - No critical asset (USDe, USDS, top-5 LSTs by TVL) without data
  - Webhook delivery rate ≥99% AND p99 ≤5s
  - Zero unresolved "source_outage" labels

TUNE if:
  - ≥1 critical asset shows >40% noise
  - Action: threshold delta documented in crates/methodology/CHANGELOG.md,
    re-run 7 days with the new threshold

EXTEND DOGFOOD if:
  - <50% of active assets have observed transitions (market too calm)
  - Action: run +14 days
```

Manual override by Rafael is permitted but must be documented in the
calibration report with a written reason. Default is the mechanical outcome.

## Why this and not pure manual sign-off

- Pure manual sign-off makes the launch date hostage to vibe — a single bad
  day in the news cycle can defer launch indefinitely.
- A mechanical rule lets us prove (on `/methodology` and in outreach) that
  the launch decision was data-driven, which is the whole trust pitch.
- Override path exists for genuine edge cases without making the default
  outcome subjective.

## Consequences

- Manual labelling work during the 14-day window is required (no tool
  classifies "noisy" alerts automatically). Estimated ~30 min/day.
- If labelling slips, default-deny: a non-labelled window = EXTEND.
- The rule itself can be revised before 2026-06-09 23:59 UTC; any revision
  after that is locked in to avoid post-hoc bias.

## Cross-refs

- `docs/CALIBRATION-v1.md` (where measurements land)
- `docs/pegana-trust-layer-v0.1.0/01-business-rules.md § 5` (deploy gate)
