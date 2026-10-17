-- migrations/0028_alert_evidence.sql
--
-- Append-only audit row per alert. Every alert dispatched in Trust Layer
-- v0.1.0+ writes one row here capturing the methodology version, the
-- frozen inputs at decision time, the computed outputs, and the canonical
-- receipt sha256. UPDATE and DELETE are blocked by PL/pgSQL triggers
-- (loosened in migration 0031 to allow onchain_tx_sig write-once).
--
-- Spec: docs/pegana-trust-layer-v0.1.0/04-data-model.md § 2

CREATE TABLE alert_evidence (
    alert_id              UUID        PRIMARY KEY REFERENCES alerts(id),

    -- Methodology identity ("what rule was in force?")
    methodology_version   TEXT        NOT NULL,
    methodology_git_sha   TEXT,
    assets_toml_sha256    CHAR(64)    NOT NULL,

    -- Frozen inputs ("what did the rule see?")
    inputs_frozen         JSONB       NOT NULL,

    -- Computed outputs ("what conclusion did it reach?")
    computed              JSONB       NOT NULL,

    -- Replay artifact (NULL for DRIFT alerts; populated for DEPEG/CRITICAL/BLACK_SWAN)
    replay_artifact       JSONB,

    -- Canonical receipt hash ("how to detect tampering?")
    receipt_sha256        CHAR(64)    NOT NULL,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only enforcement. Triggers refined in 0031 (onchain_tx_sig) and
-- subsequent migrations as additional one-way mutable columns are added.
CREATE OR REPLACE FUNCTION alert_evidence_immutable() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'alert_evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER alert_evidence_no_update
    BEFORE UPDATE ON alert_evidence
    FOR EACH ROW EXECUTE FUNCTION alert_evidence_immutable();

CREATE TRIGGER alert_evidence_no_delete
    BEFORE DELETE ON alert_evidence
    FOR EACH ROW EXECUTE FUNCTION alert_evidence_immutable();

-- Indexes for the common access patterns:
--   * "all alerts produced by methodology X" (retraction sweep on broken version)
--   * "all alerts emitted under assets.toml snapshot Y" (compare epochs)
CREATE INDEX idx_alert_evidence_methodology ON alert_evidence (methodology_version);
CREATE INDEX idx_alert_evidence_assets_hash ON alert_evidence (assets_toml_sha256);
