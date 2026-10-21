-- 0080: restore the real release dates in methodology_versions.
--
-- Every methodology migration (0030, 0041, 0044, 0051, 0062, 0066) and the
-- engine's boot-time auto-insert wrote `released_at = NOW()`, i.e. the moment
-- the row was APPLIED, not when the version was released. When the production
-- database was rebuilt (2026-10-16/17) every row was re-applied, so
-- /v1/methodology/current reported 0.7.0 as released 2026-10-16 while 0.7.0
-- receipts exist from 2026-07-28. A verifier reading that saw receipts signed
-- under a version "released" months later.
--
-- Source of each timestamp: the commit that bumped
-- crates/methodology/Cargo.toml to that version (`git log -L` on the version
-- line), which matches the dates in crates/methodology/CHANGELOG.md. Exact
-- commit times keep the 0.6.0 / 0.6.1 same-day pair in release order, which
-- matters because /v1/methodology/current orders by released_at.
--
-- Data-only and idempotent: an UPDATE per known version; versions absent from
-- the table are skipped. Future methodology migrations must write a literal
-- release timestamp, never NOW().

UPDATE methodology_versions SET released_at = '2026-05-28T20:42:04Z' WHERE version = '0.1.0';
UPDATE methodology_versions SET released_at = '2026-06-02T00:30:14Z' WHERE version = '0.2.0';
UPDATE methodology_versions SET released_at = '2026-06-04T13:51:52Z' WHERE version = '0.3.0';
UPDATE methodology_versions SET released_at = '2026-06-15T17:06:37Z' WHERE version = '0.4.0';
UPDATE methodology_versions SET released_at = '2026-07-01T18:52:04Z' WHERE version = '0.5.0';
UPDATE methodology_versions SET released_at = '2026-07-08T15:01:00Z' WHERE version = '0.6.0';
UPDATE methodology_versions SET released_at = '2026-07-08T17:12:41Z' WHERE version = '0.6.1';
UPDATE methodology_versions SET released_at = '2026-07-16T19:26:11Z' WHERE version = '0.7.0';
