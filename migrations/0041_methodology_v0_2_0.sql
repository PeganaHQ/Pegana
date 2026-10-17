-- 0041: Methodology v0.2.0 — deadband + LST premium carve-out (2026-06-01).
--
-- v0.2.0 changes the verdict for some valid inputs (a breaking change per the
-- semver rules), so it gets its own methodology_versions row and v0.1.0 is
-- deprecated. Activated immediately under the ADR-0009 critical-bug exception
-- ("wrong alerts firing"): v0.1.0 flapped DRIFT↔PEGGED around a threshold and
-- fired 🚨 DRIFT on benign LST premiums. See ADR-0021 + CHANGELOG.
--
-- 'deprecated' (not 'broken') because v0.1.0 is NOT buggy-in-the-retraction
-- sense — its receipts remain valid and replayable; we simply stop producing
-- new alerts under it. So the ADR-0003 retraction protocol does NOT fire.
--
-- Insert 0.2.0 first so the superseded_by FK on the 0.1.0 update resolves.
-- The engine also auto-inserts its compile-time version on boot
-- (ON CONFLICT DO NOTHING), so this is idempotent against a rolling deploy.

INSERT INTO methodology_versions (version, git_tag, released_at, status, notes)
VALUES (
    '0.2.0',
    'methodology-v0.2.0',
    NOW(),
    'active',
    'Schmitt-trigger deadband + LST premium carve-out. See ADR-0021.'
)
ON CONFLICT (version) DO NOTHING;

UPDATE methodology_versions
SET status        = 'deprecated',
    superseded_by = '0.2.0',
    status_reason = 'Superseded by 0.2.0 (deadband + LST premium carve-out, ADR-0021). Receipts remain valid for replay.'
WHERE version = '0.1.0';
