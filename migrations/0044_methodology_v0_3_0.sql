-- 0044: Methodology v0.3.0 — CR-side Schmitt-trigger deadband (2026-06-04).
--
-- v0.3.0 changes the verdict for some valid hyUSD inputs (a breaking change per
-- the semver rules), so it gets its own methodology_versions row and v0.2.0 is
-- deprecated. Activated immediately under the ADR-0009 critical-bug exception
-- ("wrong alerts firing"): v0.2.0 had a magnitude deadband on the SPREAD path
-- but NOT the CR path, so hyUSD flapped PEGGED↔DRIFT ~52× in two days as its
-- collateral ratio oscillated around the 130% drift band. See ADR-0023.
--
-- 'deprecated' (not 'broken') because v0.2.0 is NOT buggy-in-the-retraction
-- sense — its receipts remain valid and replayable; we simply stop producing
-- new alerts under it. So the ADR-0003 retraction protocol does NOT fire.
--
-- Insert 0.3.0 first so the superseded_by FK on the 0.2.0 update resolves.
-- The engine also auto-inserts its compile-time version on boot
-- (ON CONFLICT DO NOTHING), so this is idempotent against a rolling deploy.

INSERT INTO methodology_versions (version, git_tag, released_at, status, notes)
VALUES (
    '0.3.0',
    'methodology-v0.3.0',
    NOW(),
    'active',
    'CR-side Schmitt-trigger deadband (kills hyUSD CR-band flapping). See ADR-0023.'
)
ON CONFLICT (version) DO NOTHING;

UPDATE methodology_versions
SET status        = 'deprecated',
    superseded_by = '0.3.0',
    status_reason = 'Superseded by 0.3.0 (CR-side deadband, ADR-0023). Receipts remain valid for replay.'
WHERE version = '0.2.0';
