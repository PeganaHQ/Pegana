-- 0087: Methodology v0.8.0 (2026-10-24).
--
-- v0.8.0 adds hashed, default-omitted receipt inputs (`market_unavailable`,
-- `premium_unconfirmed`; ADR-0046 / ADR-0047), the RECEIPT_* constants the
-- verifier binds receipts to, threshold validation, and a saturating CR cast.
-- Every receipt the engine emits from this build carries methodology 0.8.0,
-- whatever the opt-in flags, so the published verifier (pegana-replay 0.5.2,
-- methodology 0.7.0) must be replaced by 0.6.0 for new receipts; 0.7.0 receipts
-- stay replayable via the version-pinned CLI.
--
-- 'deprecated' (not 'broken'): the ADR-0003 retraction protocol does NOT fire.
-- Insert 0.8.0 first so the superseded_by FK on the 0.7.0 update resolves. The
-- engine also auto-inserts its compile-time version on boot (ON CONFLICT DO
-- NOTHING), so this is idempotent against a rolling deploy. Legacy-ledger rules
-- (CLAUDE.md): never edit this file once applied; corrections are a new migration.

INSERT INTO methodology_versions (version, git_tag, released_at, status, notes)
VALUES (
    '0.8.0',
    'methodology-v0.8.0',
    NOW(),
    'active',
    'Dark-market gate and premium-confirmation gate as hashed, default-omitted receipt inputs (ADR-0046, ADR-0047); RECEIPT_* constants bound by the verifier; threshold validation at load; saturating CR cast. All new gates ship disabled; byte-exact for existing receipts. Requires pegana-replay 0.6.0.'
)
-- A rolling engine may have inserted a placeholder row first; replace only that.
ON CONFLICT (version) DO UPDATE
SET git_tag = EXCLUDED.git_tag,
    notes   = EXCLUDED.notes
WHERE methodology_versions.notes LIKE 'Auto-inserted%';

UPDATE methodology_versions
SET status        = 'deprecated',
    superseded_by = '0.8.0',
    status_reason = 'Superseded by 0.8.0 (dark-market and premium-confirmation receipt inputs, ADR-0046/0047). Receipts remain valid for replay via pegana-replay@0.5.2.'
WHERE version = '0.7.0';
