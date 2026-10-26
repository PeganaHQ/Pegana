# ADR-0027 — Time-below-peg (`sustained`) signal as enrichment, not a verdict

- **Status:** Accepted, 2026-06-24 (DEPLOYED LIVE `main` `56ef7ac`).
- **Context:** Pegana classifies on the INSTANTANEOUS smoothed discount via the FSM
  (PEGGED→…→BLACK_SWAN). Confirmed blind spot (the sUSD/Hylo analysis): it cannot
  distinguish a 5-minute blip from a slow MECHANISM depeg that sits ~2% below peg for
  months. We add a duration dimension.

## Decision

Track `band_since` (when the asset last entered its current committed FSM band) in
`AssetRuntime`, persist it in `engine_state_snapshot` (migration 0057, ADR-0010 cache —
NOT a replay input), and derive `current_state_duration_secs` + a `sustained` boolean.
Surface both as **enrichment** on `event.extra` → `discount_snapshots.extra` → `/v1/assets`
→ web badge. **It is NOT a methodology change**: `band_since`/`sustained` never enter
`InputsFrozen`/`Computed`/the receipt hash (proven — methodology suite green, empty
`crates/methodology` diff), so there is no version bump, no replay, no receipt impact.

## Why this is NOT the ADR-0024 freeze detector (the decisive point)

ADR-0024 rejected a discount-**constancy** detector because a healthy illiquid asset sits
at a constant small discount for hours (ONyc ~20h, vSOL 6.5h, even USDC 67min) — no
constancy threshold separates flat-healthy from frozen, and it false-positived on healthy
public JupSOL within minutes.

`sustained` keys on something categorically different: **residence in a committed ALERTING
band (DRIFT+)**. A PEGGED/UNKNOWN asset is NEVER `sustained` regardless of discount
magnitude, constancy, or elapsed time. The band crossing is exactly what the freeze
detector lacked. Enforced by the pure `sustained_for(state, duration)` and proven by the
proptest-style guard `sustained_keys_only_on_committed_alerting_band`.

## Considered and rejected

- **Option C — let duration DRIVE/escalate the published state** (e.g. DRIFT-sustained →
  DEPEG). Rejected for now: it changes `final_state` for some inputs → MINOR methodology
  bump + receipt-hash change + the ADR-0009 7-day cadence, and re-imports ADR-0024 risk if
  the threshold is loose. It is also a *demand* question (does a partner need it?) not a
  code one — ship enrichment, observe, revisit only if pulled.

## Consequences

- **Thresholds** (`sustained` at DRIFT ≥ 6h, severe bands ≥ 1h) are tunable engine
  constants, NOT methodology-versioned — un-calibrated defaults; tighten against observed
  data later.
- **`force_unknown` resets `band_since`** (UNKNOWN is a band change). A transient
  NAV-sanity UNKNOWN therefore restarts a sustained clock — honest (we genuinely don't
  know during UNKNOWN) but it can mask a sustained episode; accepted.
- **Backfill (review F1).** `band_since` is only stamped going-forward, so the bare
  `ALTER` would have left the signal invisible at deploy for assets ALREADY in a long
  episode (sUSD). Migration 0057 backfills it from `discount_snapshots` history (the
  current band's entry boundary), bounded by the 365-day retention. Verified live: sUSD
  shows `sustained=true`, ~2.4d in DRIFT, on day one.
- Pending surfaces: the bot alert string ("in DRIFT for N") renders `event.extra` on
  transition; the threshold calibration follow-up.
