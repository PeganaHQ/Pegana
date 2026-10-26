-- migrations/0032_retractions.sql
--
-- Retraction log per ADR-0003 (methodology retraction protocol). When
-- methodology_versions.status flips to 'broken', the dispatcher fires a
-- one-shot retraction protocol:
--   1. Banner on /audit/[id] for every alert produced by the broken version
--   2. ONE on-chain memo tx (not one-per-alert)
--   3. Webhook re-fire to every subscription that received any affected alert
--   4. RSS item with <category>retraction</category>
--   5. Bot alert_retracted template (PT-BR + EN) to affected chats
--   6. API field retracted: bool on GET /v1/audit/:id
--
-- This table records the retraction event itself. The retracted=true status
-- on alert_evidence rows is DERIVED at query time by joining against this
-- table — original alert_evidence rows are NEVER mutated (per ADR-0003 policy).
--
-- ADR reference: docs/adr/0003-methodology-retraction-protocol.md

CREATE TABLE retractions (
    methodology_version   TEXT        PRIMARY KEY REFERENCES methodology_versions(version),
    retracted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Short bug identifier (e.g. "ewma_alpha_off_by_one"), used as the
    -- retraction_reason field in webhook re-fire payload and surfaced
    -- on /methodology#broken-versions.
    reason                TEXT        NOT NULL,

    -- The one-shot on-chain memo tx signature (NULL until commit lands).
    -- Payload format per ADR-0003: PEGANA_RETRACT|<broken_version>|<alert_count>|<reason>
    onchain_tx_sig        TEXT,

    -- Counts incremented by the dispatcher as it fans out the retraction signal.
    -- Useful for the operational runbook + /methodology timeline.
    webhook_refire_count  INTEGER     NOT NULL DEFAULT 0,
    bot_refire_count      INTEGER     NOT NULL DEFAULT 0,

    -- Human-readable diff or PR link explaining the fix.
    fix_url               TEXT
);

COMMENT ON TABLE retractions IS
    'One row per broken methodology version. JOIN against alert_evidence to '
    'derive retracted status. Original alert_evidence rows never mutate '
    '(ADR-0003 additive-only policy).';

-- Index supports the /audit page query "is this alert retracted?":
--   SELECT EXISTS (SELECT 1 FROM retractions WHERE methodology_version = ae.methodology_version)
-- (Primary key already covers the lookup; this is a no-op kept as documentation.)
