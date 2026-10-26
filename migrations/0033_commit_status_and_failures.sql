-- migrations/0033_commit_status_and_failures.sql
--
-- On-chain commit lifecycle bookkeeping per ADR-0004.
--
-- Adds:
--   * commit_status enum column on alert_evidence (replaces "NULL means
--     either pending or skipped" ambiguity)
--   * alert_evidence_commit_failures table for the background retry worker
--
-- The commit_status enum makes the UI explicit (per ADR-0004):
--   not_applicable  — alert was DRIFT, no on-chain commit attempted
--   pending         — attempt started, not yet failed, within 24h window
--   committed       — onchain_tx_sig IS NOT NULL (success)
--   retry_exhausted — 3 hard failures + 24h retry window expired
--   wallet_drained  — InsufficientFundsForFee from RPC
--
-- The trigger from 0031 is loosened again to permit commit_status to
-- mutate in the expected progressions only (state machine).
--
-- ADR reference: docs/adr/0004-onchain-commit-policy.md

-- Enum for commit lifecycle (text enum keeps migrations simple vs CREATE TYPE).
ALTER TABLE alert_evidence ADD COLUMN commit_status TEXT
    NOT NULL DEFAULT 'not_applicable'
    CHECK (commit_status IN (
        'not_applicable', 'pending', 'committed', 'retry_exhausted', 'wallet_drained'
    ));

CREATE INDEX idx_alert_evidence_commit_status_pending
    ON alert_evidence (created_at)
    WHERE commit_status = 'pending';

COMMENT ON COLUMN alert_evidence.commit_status IS
    'On-chain commit lifecycle (ADR-0004). Set to ''pending'' when the '
    'engine spawns the commit task; flips to ''committed'' alongside '
    'onchain_tx_sig write; flips to ''retry_exhausted'' or ''wallet_drained'' '
    'on terminal failure. ''not_applicable'' for non-critical alerts.';

-- Background-retry worker tracking. Insert one row per FIRST hard failure;
-- worker re-attempts every 1h for 24h, then marks the parent row
-- commit_status='retry_exhausted'. The row stays for forensic visibility.
CREATE TABLE alert_evidence_commit_failures (
    alert_id        UUID        PRIMARY KEY REFERENCES alert_evidence(alert_id),
    first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts        INTEGER     NOT NULL DEFAULT 1,
    last_error      TEXT        NOT NULL,
    error_kind      TEXT        NOT NULL
        CHECK (error_kind IN ('rpc', 'blockhash', 'insufficient_funds', 'other')),
    -- Set when the worker has given up (mirrors alert_evidence.commit_status).
    abandoned_at    TIMESTAMPTZ
);

CREATE INDEX idx_commit_failures_pending
    ON alert_evidence_commit_failures (last_attempted_at)
    WHERE abandoned_at IS NULL;

COMMENT ON TABLE alert_evidence_commit_failures IS
    'Background-retry queue for on-chain commits that failed at least once. '
    'Worker scans WHERE abandoned_at IS NULL and last_attempted_at < NOW() - 1h. '
    'After 24h since first_failed_at, marks abandoned and updates parent '
    'alert_evidence.commit_status to retry_exhausted (or wallet_drained if '
    'error_kind = insufficient_funds).';

-- Re-create the trigger to allow commit_status to advance per the state
-- machine (no arbitrary writes; only NULL or pending → terminal state).
CREATE OR REPLACE FUNCTION alert_evidence_immutable() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Block any change to the frozen audit columns.
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
            RAISE EXCEPTION 'alert_evidence is append-only — only onchain_tx_sig and commit_status may transition';
        END IF;

        -- onchain_tx_sig is write-once (NULL → non-NULL).
        IF NEW.onchain_tx_sig IS DISTINCT FROM OLD.onchain_tx_sig THEN
            IF OLD.onchain_tx_sig IS NOT NULL THEN
                RAISE EXCEPTION 'onchain_tx_sig is write-once';
            END IF;
        END IF;

        -- commit_status state machine:
        --   not_applicable → (terminal, must never change)
        --   pending        → committed | retry_exhausted | wallet_drained
        --   committed | retry_exhausted | wallet_drained → (terminal)
        IF NEW.commit_status IS DISTINCT FROM OLD.commit_status THEN
            IF OLD.commit_status = 'not_applicable' THEN
                RAISE EXCEPTION 'commit_status not_applicable is terminal';
            END IF;
            IF OLD.commit_status IN ('committed', 'retry_exhausted', 'wallet_drained') THEN
                RAISE EXCEPTION 'commit_status % is terminal', OLD.commit_status;
            END IF;
            IF OLD.commit_status = 'pending' AND
               NEW.commit_status NOT IN ('committed', 'retry_exhausted', 'wallet_drained') THEN
                RAISE EXCEPTION 'commit_status pending may only advance to committed | retry_exhausted | wallet_drained';
            END IF;
        END IF;

        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'alert_evidence is append-only';
END;
$$ LANGUAGE plpgsql;
