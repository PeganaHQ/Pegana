-- migrations/0031_alert_evidence_onchain_sig.sql
--
-- Adds the on-chain commit signature column to alert_evidence and
-- updates the immutability trigger to permit ONE write-once transition
-- (NULL → non-NULL) on this column only. All other columns remain frozen.
--
-- Filled by crates/engine-rs/src/onchain_commit.rs::commit_receipt after
-- the SPL Memo transaction confirms on Solana mainnet. The partial index
-- supports the background retry worker (ADR-0004) scanning for pending
-- commits.
--
-- Spec: docs/pegana-trust-layer-v0.1.0/04-data-model.md § 5

ALTER TABLE alert_evidence ADD COLUMN onchain_tx_sig TEXT;

CREATE INDEX idx_alert_evidence_onchain_pending
    ON alert_evidence (created_at)
    WHERE onchain_tx_sig IS NULL;

COMMENT ON COLUMN alert_evidence.onchain_tx_sig IS
    'Solana transaction signature of on-chain receipt commit via SPL Memo. '
    'NULL until commit_receipt() completes async. Write-once.';

-- Update the immutability trigger to permit a single NULL→non-NULL update
-- of onchain_tx_sig per row. Every other column remains frozen.
CREATE OR REPLACE FUNCTION alert_evidence_immutable() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.alert_id            IS DISTINCT FROM OLD.alert_id
            OR NEW.methodology_version IS DISTINCT FROM OLD.methodology_version
            OR NEW.methodology_git_sha IS DISTINCT FROM OLD.methodology_git_sha
            OR NEW.assets_toml_sha256  IS DISTINCT FROM OLD.assets_toml_sha256
            OR NEW.inputs_frozen       IS DISTINCT FROM OLD.inputs_frozen
            OR NEW.computed            IS DISTINCT FROM OLD.computed
            OR NEW.replay_artifact     IS DISTINCT FROM OLD.replay_artifact
            OR NEW.receipt_sha256      IS DISTINCT FROM OLD.receipt_sha256
            OR NEW.created_at          IS DISTINCT FROM OLD.created_at
        THEN
            RAISE EXCEPTION 'alert_evidence is append-only — only onchain_tx_sig may be set once';
        END IF;
        IF OLD.onchain_tx_sig IS NOT NULL THEN
            RAISE EXCEPTION 'onchain_tx_sig is write-once';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'alert_evidence is append-only';
END;
$$ LANGUAGE plpgsql;
