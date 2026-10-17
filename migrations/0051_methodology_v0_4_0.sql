-- 0051: Methodology v0.4.0 — validation follow-up honesty guards (2026-06-15).
--
-- v0.4.0 adds three additive publish-time guards (ADR-0025):
--   1. NAV-sanity premium cap → publish UNKNOWN when a direction-sensitive
--      asset shows a premium beyond NAV_PREMIUM_SANITY_BPS=1000 (broken anchor;
--      fixes sHYUSD's masked-PEGGED).
--   2. No-Pyth confidence cap → an asset with no Pyth cross-check caps at MEDIUM
--      (today exactly sUSD).
--   3. Spread-reachable BLACK_SWAN at 2x critical (the 5th state was previously
--      reachable only via the CR path).
-- It changes the verdict for some inputs at pathological magnitudes (a
-- MINOR/breaking change per semver), so it gets its own methodology_versions
-- row and v0.3.0 is deprecated.
--
-- Shipped inside the post-launch observation window under a deliberate FOUNDER
-- OVERRIDE of both the 2026-06-25 stability lock AND the ADR-0009 7-day
-- announce + passive dual-run cadence. This is NOT the ADR-0009 critical-bug
-- exception — it is a conscious founder call recorded here and in ADR-0025.
--
-- 'deprecated' (not 'broken'): v0.3.0 receipts remain valid and replayable; we
-- simply stop producing new alerts under it. The ADR-0003 retraction protocol
-- does NOT fire.
--
-- Insert 0.4.0 first so the superseded_by FK on the 0.3.0 update resolves. The
-- engine also auto-inserts its compile-time version on boot (ON CONFLICT DO
-- NOTHING), so this is idempotent against a rolling deploy.

INSERT INTO methodology_versions (version, git_tag, released_at, status, notes)
VALUES (
    '0.4.0',
    'methodology-v0.4.0',
    NOW(),
    'active',
    'Validation follow-up honesty guards: NAV-sanity premium cap (UNKNOWN on broken anchor), no-Pyth confidence cap (MEDIUM), spread-reachable BLACK_SWAN (2x critical). See ADR-0025.'
)
ON CONFLICT (version) DO NOTHING;

UPDATE methodology_versions
SET status        = 'deprecated',
    superseded_by = '0.4.0',
    status_reason = 'Superseded by 0.4.0 (validation follow-up honesty guards, ADR-0025). Receipts remain valid for replay.'
WHERE version = '0.3.0';
