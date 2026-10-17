# ADR 0002 — Per-asset activation rule for Phase 0 additions

**Status**: Accepted (2026-05-28)
**Context**: Trust Layer v0.1.0 launch, Phase 0 calibration window

## Problem

The spec required "all 5 new assets within plausible threshold ranges" as a
launch gate, treating Phase 0 additions (JupUSD, JLP, EURC, dzSOL, vSOL) as
an atomic block. Two concrete issues:

1. **No slack in calibration window**: assets added 2026-05-28, launch
   2026-06-11 = exactly 14 days. Any delay confirming mint addresses or
   Pyth feed IDs ate into the window.
2. **JupUSD risk**: launched January 2026, Pyth feed may not exist or be
   thin; not worth blocking the whole launch on it.
3. **"Plausible threshold" undefined**: deploy gate item #4 referenced a
   concept with no measurable definition.

## Decision

Decision is per-asset at 2026-06-10, not all-or-nothing:

```
PER-ASSET AT VERDICT TIME:
  - <10 complete days of data         → defer activation
                                        (stays active=false; revisit in 7 days)
  - 10-14 days AND p99 within threshold → activate at launch
  - 14 days AND p99 outside threshold   → activate WITH warning banner on
                                        /audit, thresholds loosened,
                                        documented in CHANGELOG.md
  - Mint unconfirmed by 2026-05-30    → drop from v0.1.0, defer to Phase 14

LAUNCH-LEVEL KILL:
  - ≥3 of 5 new assets deferred       → launch slip to 2026-06-18 (+7 days)
  - JupUSD specifically may be dropped without slip
    (risky asset; "5→4" is acceptable; metric is quality not count)
```

## Why this and not "all 5 or slip"

- A single unreadily asset (likely JupUSD) shouldn't hold the launch.
- The trust narrative is "we measure before we ship," not "we hit numbers."
  Defer + document is consistent with that narrative; force-shipping isn't.
- 5→4 active additions is still a meaningful expansion (21→25).

## Consequences

- Calibration report at 06-10 must include per-asset decision and the
  data behind it.
- /audit and /methodology pages need a "deferred assets" section listing
  any Phase 0 additions not active at launch and the reason.
- `assets.toml` keeps deferred entries with `active=false` and a
  `# deferred per ADR-0002 on YYYY-MM-DD` comment.

## Cross-refs

- `docs/pegana-trust-layer-v0.1.0/plans/01-phase-0-preflight.md` Task 0.2
- `docs/pegana-trust-layer-v0.1.0/01-business-rules.md § 5` (deploy gate #4)
- `docs/pegana-trust-layer-v0.1.0/03-asset-coverage.md`
