-- 0066: Methodology v0.7.0 — Pyth confidence-gate (2026-07-16).
--
-- v0.7.0 adds a third, independent verdict override alongside the 0.4.0/0.5.0
-- NAV-sanity guards (ADR-0032): pyth_confidence_gate_violated +
-- PYTH_CONFIDENCE_GATE_BPS=500. When a cached Pyth reading an asset depends on
-- (intrinsic and/or market leg) has a confidence/price ratio wider than 500
-- bps (5%), the verdict is forced to honest-dark UNKNOWN rather than trusting
-- a possibly-wrong reading. Conservative-only: can only push a verdict toward
-- UNKNOWN, never away from it. It changes the verdict only when a required
-- Pyth feed's confidence interval is implausibly wide relative to price, so it
-- gets its own methodology_versions row and v0.6.1 is deprecated.
--
-- STRUCTURALLY INERT on the 2025-10-10 backtest (drift-gate: 0 state changes;
-- only the version field drifts) because the xtask runner never populates
-- `pyth_entries` for that fixture. Calibration against the live
-- `oracle_snapshots` universe (Query A/B in ADR-0032) — to confirm near-zero
-- historical trips at the 500bps default — is the founder's call before/soon
-- after deploy; the constant may be tightened or widened from that data. See
-- ADR-0032 + CHANGELOG 0.7.0.
--
-- 'deprecated' (not 'broken'): v0.6.1 receipts remain valid and replayable via
-- the version-pinned CLI (`cargo install pegana-replay@0.4.4`); the ADR-0003
-- retraction protocol does NOT fire.
--
-- Insert 0.7.0 first so the superseded_by FK on the 0.6.1 update resolves. The
-- engine also auto-inserts its compile-time version on boot (ON CONFLICT DO
-- NOTHING), so this is idempotent against a rolling deploy.

INSERT INTO methodology_versions (version, git_tag, released_at, status, notes)
VALUES (
    '0.7.0',
    'methodology-v0.7.0',
    NOW(),
    'active',
    'Pyth confidence-gate: a wide confidence/price ratio (>500bps) on any Pyth reading an asset depends on forces honest-dark UNKNOWN instead of trusting a possibly-wrong intrinsic/market leg. Conservative-only, third override alongside premium/discount sanity. Structurally inert on the 2025-10-10 backtest (no captured Pyth data in that fixture). See ADR-0032.'
)
ON CONFLICT (version) DO NOTHING;

UPDATE methodology_versions
SET status        = 'deprecated',
    superseded_by = '0.7.0',
    status_reason = 'Superseded by 0.7.0 (Pyth confidence-gate, ADR-0032). Receipts remain valid for replay via pegana-replay@0.4.4.'
WHERE version = '0.6.1';
