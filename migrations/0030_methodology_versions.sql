-- migrations/0030_methodology_versions.sql
--
-- Methodology version lifecycle. One row per released version of the
-- pegana-methodology crate. Engine validates its compile-time version
-- against this table on startup (see crates/engine-rs/src/main.rs).
--
-- Status semantics:
--   active     — production-blessed; engine starts cleanly.
--   deprecated — still installable for replay; new alerts should not be
--                produced. Engine warns but starts.
--   broken     — known buggy; engine REFUSES to start. Past alerts marked
--                via the retractions table (migration 0032) trigger the
--                retraction protocol per ADR-0003.
--
-- The seed row covers v0.1.0 (initial release; extracted from engine
-- v0.1.0 with no behavior change per Phase 1).
--
-- Spec: docs/pegana-trust-layer-v0.1.0/04-data-model.md § 4

CREATE TABLE methodology_versions (
    version       TEXT        PRIMARY KEY,
    git_tag       TEXT        NOT NULL,
    released_at   TIMESTAMPTZ NOT NULL,
    status        TEXT        NOT NULL CHECK (status IN ('active', 'deprecated', 'broken')),
    status_reason TEXT,
    superseded_by TEXT REFERENCES methodology_versions(version),
    notes         TEXT
);

INSERT INTO methodology_versions (version, git_tag, released_at, status, notes)
VALUES (
    '0.1.0',
    'methodology-v0.1.0',
    NOW(),
    'active',
    'Initial release. Extracted from engine v0.1.0; no behavior change.'
);
