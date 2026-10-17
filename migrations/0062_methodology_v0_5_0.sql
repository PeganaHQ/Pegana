-- 0062: Methodology v0.5.0 — intrinsic-sanity discount-side guard (2026-07-01).
--
-- v0.5.0 adds the discount-side mirror of the 0.4.0 NAV premium-sanity (ADR-0030):
--   discount_sanity_violated + NAV_DISCOUNT_SANITY_BPS=3000. A garbage-HIGH
--   intrinsic (a broken NAV/RR feed print, e.g. JLP's JLP/USD.RR = 21817 vs a
--   correct 3.41 on 2026-06-24 → 99.98% discount) is published as honest-dark
--   UNKNOWN instead of a false CRITICAL/BLACK_SWAN. It changes the verdict only
--   at pathological magnitudes (>30% discount on a direction-sensitive class), so
--   it gets its own methodology_versions row and v0.4.0 is deprecated.
--
-- PROVEN INERT on the live universe (max real direction-sensitive discount = 245
-- bps << 3000) and on the 2025-10-10 backtest (drift-gate: 0 state changes; only
-- the version field drifts). See ADR-0030 + CHANGELOG 0.5.0.
--
-- 'deprecated' (not 'broken'): v0.4.0 receipts remain valid and replayable via
-- the version-pinned CLI (`cargo install pegana-replay@0.4.1`); the ADR-0003
-- retraction protocol does NOT fire. The published latest CLI (pegana-replay
-- 0.4.2) embeds 0.5.0 and re-derives 0.5.0 receipts.
--
-- Insert 0.5.0 first so the superseded_by FK on the 0.4.0 update resolves. The
-- engine also auto-inserts its compile-time version on boot (ON CONFLICT DO
-- NOTHING), so this is idempotent against a rolling deploy.

INSERT INTO methodology_versions (version, git_tag, released_at, status, notes)
VALUES (
    '0.5.0',
    'methodology-v0.5.0',
    NOW(),
    'active',
    'Intrinsic-sanity discount-side guard: a garbage-HIGH intrinsic (>30% discount on a direction-sensitive class = broken NAV anchor) publishes honest-dark UNKNOWN instead of a false CRITICAL/BLACK_SWAN. Mirror of the 0.4.0 premium-sanity. Proven inert on the live universe + the 2025-10-10 backtest. See ADR-0030.'
)
ON CONFLICT (version) DO NOTHING;

UPDATE methodology_versions
SET status        = 'deprecated',
    superseded_by = '0.5.0',
    status_reason = 'Superseded by 0.5.0 (intrinsic-sanity discount-side guard, ADR-0030). Receipts remain valid for replay via pegana-replay@0.4.1.'
WHERE version = '0.4.0';
