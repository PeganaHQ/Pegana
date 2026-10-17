# ADR-0017: Pre-evidence sub-window threshold exercise

- **Status:** Accepted
- **Date:** 2026-05-29
- **Supersedes:** none
- **Amended by:** none
- **Related:** ADR-0005, ADR-0009, ADR-0013

## Context

Issue #101 ("validate evidence write path with first real alert") is the
only acceptance criterion gating the launch verdict (2026-06-10) whose
completion depends on the market dispatching a real Pegged→Depeg
transition. Historical alert rate is ~12/day across 22 active assets;
most assets sit in firm Pegged. Probability of zero transitions in
evidence sub-window 2026-06-01..06-09 is non-trivial and cannot be
allowed to block the verdict.

ADR-0009 batches threshold tweaks weekly as PATCH bumps. ADR-0013 treats
every `assets.toml` change as a new epoch (visible in UI). Together
those rule out ad-hoc threshold edits inside the **evidenced sub-window**
(2026-06-01..06-10 per ADR-0005). But ADR-0005 also names the
**pre-evidence sub-window** (2026-05-27..05-31) as informational only —
verdict computes from the evidenced sub-window.

We need a documented mechanism to exercise the evidence write path
deterministically without polluting the verdict-authoritative dataset.

## Decision

Allow short, documented threshold-exercise runs in the **pre-evidence
sub-window only** (2026-05-27..05-31 23:59 UTC) under the following
invariants:

1. **Asset choice.** Prefer historically-stable, low-impact assets.
   USDC is the canonical choice. Do NOT exercise on assets that carry
   signal (USDe, sUSDe, hyUSD, sHYUSD) — premature transitions on
   those assets become misleading even in the informational sub-window.

2. **Tightening window.** Each exercise run holds the tightened
   threshold for ≤120 seconds. Long enough to clear
   `confirm_up_secs=30s` and mature the candidate; short enough to
   keep one epoch per run.

3. **Threshold magnitude.**
   - `drift_bps: 20 → 1` exercises evidence INSERT + replay artifact
     + receipt SHA path. Does NOT trigger `on_chain_commit` (gated
     by Depeg|Critical|BlackSwan in `engine-rs/src/main.rs:969-977`).
   - `depeg_bps: 100 → 2` exercises the on-chain commit path
     (`initial_commit_status='pending'` → `'committed'`).

4. **Revert immediately** after the candidate transition matures.
   The revert is itself a new `assets.toml` epoch.

5. **FEATURE_PUBLIC_ALERTS must be `false`** during the exercise.
   Alerts route to the dogfood Telegram chat
   (`DOGFOOD_TELEGRAM_CHAT_ID`).

6. **Document the run** in
   `docs/operations/issue-101-exercise-log.md` with: alert_id,
   pre/exercise/revert epoch hashes, Solscan tx_sig (depeg run only),
   gate-check SQL output.

7. **No exercises in the evidenced sub-window** (2026-06-01..06-10).
   Required: any post-cutoff exercise waits until 2026-06-11.

## Consequences

- The epoch history records up to four transient threshold-tightening
  epochs visible in the UI (Run 1 pre/post + Run 2 pre/post). The
  epoch badge tooltip links to this ADR + the exercise log so a third
  party reading the audit page understands the context.

- The methodology version does NOT bump for these runs because the
  methodology crate is unchanged; only `assets.toml` changes (per
  ADR-0013, `assets.toml` epoch hashes are separate from methodology
  versions).

- One or two rows in `alert_evidence` whose `assets_toml_sha256`
  matches an exercise epoch become permanently public-readable. The
  audit page records this via the exercise-log link so a third party
  replaying the receipt understands the threshold context.

- Future calibration cycles inherit this precedent: pre-evidence
  threshold exercises are allowed under invariants 1-7; evidenced-
  sub-window exercises are not.

## Alternatives considered

- **Synthetic alert via direct INSERT into `alert_evidence`.**
  Rejected. Bypasses the engine→evidence→commit path; defeats the
  point of #101. A receipt without a real candidate transition cannot
  be replayed against engine logs.

- **Staging stack with mainnet RPC + devnet x402 facilitator.**
  Acceptable as a fallback (Option C in the original proposal), but
  adds 30-60 min of setup with no carry-over value for future
  calibration cycles. Preserved here as fallback if for any reason
  the production pre-evidence window is unavailable.

- **Wait for a natural transition.** Rejected. Probability of zero
  natural transitions in the 12-day evidenced sub-window is
  non-trivial; #101 cannot block the verdict on a market event we
  cannot schedule.

## References

- ADR-0005 — early-evidence rollout (defines pre-evidence vs evidenced
  sub-windows).
- ADR-0009 — methodology bump cadence (weekly batching for threshold
  tweaks; this ADR carves out the exercise exception).
- ADR-0013 — assets.toml epochs visible in UI.
- Issue #101 — original "validate evidence write path with first real
  alert" gate.
- `docs/operations/issue-101-exercise-log.md` — execution log
  template for the two runs.
