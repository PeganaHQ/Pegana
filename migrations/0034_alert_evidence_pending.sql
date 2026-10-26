-- migrations/0034_alert_evidence_pending.sql
--
-- Dead-letter queue for alert_evidence INSERT failures per ADR-0006.
--
-- Business rule #10 from docs/pegana-trust-layer-v0.1.0/01-business-rules.md:
--   "Never let an alert_evidence insert failure abort an alert dispatch.
--    Order of priority: deliver the alert > persist evidence. We retry
--    persistence; we never silence the alert."
--
-- This table is the concrete implementation. When push_alert's INSERT
-- into alert_evidence fails (DB deadlock, disk full, etc.), the engine
-- captures the would-be row here. A background retry task (every 30s)
-- attempts the INSERT into alert_evidence. After 24h with no success,
-- the row is marked failed_permanent and Rafael is paged.
--
-- The corresponding webhook payload field evidence_status carries one of
-- ready | pending | failed_permanent so consumers can distinguish
-- "audit URL will work momentarily" from "audit URL will 404 forever".
--
-- The /v1/audit/:id API returns:
--   200 — row in alert_evidence (status: ready)
--   202 — row in alert_evidence_pending only (status: pending, retry_after_seconds: 60)
--   410 — failed_permanent (status: persistence_failed)
--   404 — no row anywhere (genuinely unknown alert_id)
--
-- ADR reference: docs/adr/0006-alert-evidence-persistence-failure.md

CREATE TABLE alert_evidence_pending (
    alert_id              UUID        PRIMARY KEY REFERENCES alerts(id),

    -- Full payload that should land in alert_evidence on retry success.
    -- Stored as a single JSONB blob to keep the schema decoupled from
    -- alert_evidence's evolving column set (0031 added onchain_tx_sig,
    -- 0033 added commit_status, future migrations may add more).
    payload               JSONB       NOT NULL,

    -- Retry bookkeeping.
    queued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_attempted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts              INTEGER     NOT NULL DEFAULT 0,
    last_error            TEXT,

    -- Terminal state after 24h of failure. Webhook evidence_status flips
    -- to failed_permanent; /v1/audit/:id returns 410.
    failed_permanently_at TIMESTAMPTZ
);

-- Worker scan path: pending rows still eligible for retry.
CREATE INDEX idx_pending_eligible
    ON alert_evidence_pending (last_attempted_at)
    WHERE failed_permanently_at IS NULL;

COMMENT ON TABLE alert_evidence_pending IS
    'Dead-letter queue for failed alert_evidence INSERTs. Engine writes here '
    'when push_alert''s synchronous INSERT fails (rule #10: deliver alert > '
    'persist evidence). Background task retries every 30s; after 24h sets '
    'failed_permanently_at and pages Rafael. The /v1/audit/:id endpoint '
    'inspects this table to return 202 (pending) or 410 (failed) instead '
    'of 404 — preserves the trust narrative ("we are honest about state").';
