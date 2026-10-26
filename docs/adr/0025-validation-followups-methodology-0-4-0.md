# ADR-0025 — Validation follow-ups: methodology 0.4.0 honesty guards

- **Status:** Accepted, 2026-06-15
- **Context:** The 2026-06-14 validation handoff (`docs/2026-06-14-pegana-validation-handoff.md`, §6) listed a cluster of correctness/honesty gaps. This ADR records the methodology **0.4.0** bump that closes them. Rafael explicitly authorised shipping inside the post-launch observation window (overriding the `2026-06-25` stability lock in `docs/operations/monitoring-only-promotion-criteria.md`); see "Calibration impact" below for why three of the four changes do not contaminate the verdict and the one that does is bounded.
- **Cadence:** A methodology behaviour change → version bump per ADR-0009. These are **additive publish-time guards**; no existing drift/depeg/critical band threshold is altered.

## Decisions

### 1. NAV-sanity premium cap (`premium_sanity_violated`, `NAV_PREMIUM_SANITY_BPS = 1000`)
A premium (negative discount) beyond **10%** on a direction-sensitive class (LST, stable_yield) is judged a broken NAV/intrinsic anchor, not demand pressure. ADR-0021's premium→PEGGED carve-out otherwise masks it as a confident PEGGED off a garbage anchor — the validation "formula caveat" (sHYUSD: market ≈ +30% over a thin-Jupiter NAV print, yet PEGGED). The engine (`try_recompute`) now publishes honest-dark **UNKNOWN** + `unknown` confidence via `force_unknown` (keeps `last_state`/candidate in sync so the FSM resumes via the cold-start path when the anchor recovers).

- **Bound rationale:** the widest legitimate premium observed across the 26 assets is INF ≈ 160 bps; 1000 bps leaves a >6× margin. Discount side and symmetric classes are untouched — a real market-below-NAV move still classifies on the bands.
- **Not ADR-0024.** This is a magnitude check on one smoothed sample, NOT the discount-**constancy** freeze detector ADR-0024 rejected (no constancy threshold could separate flat-healthy from frozen). hyloSOL+'s frozen-but-small-discount case is unaffected here — it stays contained via `monitoring_only` (migration 0049).

### 2. Confidence gate (no Pyth cross-check → cap MEDIUM)
An asset with **no Pyth feed anywhere** (neither a `pyth_spot`/`jupiter_usd`-numeraire market nor a `pyth_*` intrinsic) has no independent oracle cross-check, so `pyth_confidence_for_asset` can no longer return `high` for it — it caps at `medium`. Verified blast radius: exactly **sUSD** (DexScreener ~$8k pool + custom rate). Every other active asset has a Pyth dependency and is unchanged. Answers the validation grill "why does sUSD carry HIGH off a thin single source?".

### 3. BLACK_SWAN reachable from spread (`state_for_bps_discount`, default `2 × critical`)
The bps path previously topped at CRITICAL; only the CR path (hyUSD) could reach BLACK_SWAN, so the publicly-advertised 5th state was unreachable for 25/26 assets (the "Four/Five states" honesty gap — the landing even read "Four states" beside a "5-state FSM" footnote). The bps path now has a black_swan band, default `2 × critical`, overridable per-asset via `black_swan` / `black_swan_bps`. Landing copy corrected to "Five states".

- **Not terminal.** The marketing/docs language of "never auto-exits / requires operator review" is **not** implemented: BLACK_SWAN auto-exits via normal hysteresis like every other band, because no operator-reset path exists to make a no-decay terminal state safe (a false or recovered black_swan would otherwise be stuck). The CR-path black_swan (hyUSD) already behaved this way. Docs that imply terminal behaviour should be softened (docs-audit workstream, `docs/2026-06-15-pegana-docs-audit.md`).
- Re-labels only the most extreme moves (already CRITICAL today); nothing at or below critical changes.

### 4. (Display) premium/discount copy, direction-sensitive chart guides, quiet 404 — web only, no methodology impact (commit `8414953`).

## Calibration impact (why the override is bounded)
- **Confidence gate** changes a display label only — not a band, not a state — so it cannot move the calibration verdict.
- **NAV-sanity** and **black_swan** *can* change published state, but only at magnitudes far outside any band a calibrated asset reaches in normal operation (≥10% premium; ≥2× critical). No asset in the current window sits near either boundary except sHYUSD (already a known red flag, monitoring_only). So the 06-18 retro / 06-25 verdict for the calibrated cohort is not materially perturbed.
- This is **not** the freeze-detector mistake (ADR-0024), which false-positived on healthy public assets (JupSOL) at a normal operating point. These guards fire only at clearly-pathological magnitudes.

## Consequences
- Methodology version `0.3.0 → 0.4.0`; new receipts record `0.4.0` and `pegana-replay` flags pre-0.4.0 receipts as VERSION_MISMATCH (expected).
- **ADR-0009 cadence obligation (deferred under the same founder override).** A `0.x → 0.x+1` bump is a **MINOR / breaking change** in ADR-0009's table, whose stated cadence is a **7-day announcement before activation (RSS + email to webhook subscribers) + a 7-day passive run alongside the current version**. These guards fire only at clearly-pathological magnitudes (≥10% premium; ≥2× critical) and on assets that are either already CRITICAL or already `monitoring_only`, so Rafael is **consciously deferring/compressing** that 7-day announce + passive dual-run under the **same founder override that lifted the 06-25 stability lock** (this is a deliberate founder call, *not* the ADR-0009 critical-bug exception). **The final deploy note MUST record the decision — honor the 7-day cadence vs. override it — before the engine recreate.**
- Deploy is a single deliberate `deploy.sh --services 'engine'` recreate (held pending Rafael's review of the full package, per the 2026-06-15 session).
- Follow-ups still open from the same handoff: EWMA escalation-latency, signed non-event attestation (P0#3), per-class vol-adjusted bands.
