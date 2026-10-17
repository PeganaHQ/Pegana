-- migrations/0037_block_truncate.sql
--
-- Closes the TRUNCATE bypass on append-only tables.
--
-- Wave 3A review (/review-and-iterate) flagged a P1: the
-- alert_evidence_immutable() trigger from 0028+0031+0033 only registers
-- BEFORE UPDATE and BEFORE DELETE. TRUNCATE bypasses both, wiping the
-- entire audit log in one statement — collapsing the "every alert is
-- forever auditable" trust pitch.
--
-- Fix: add a separate BEFORE TRUNCATE trigger (fires FOR EACH STATEMENT,
-- not FOR EACH ROW like the existing one) on every table whose contents
-- are meant to be permanent.
--
-- Note: DROP TABLE still works for any user with DDL privileges. Full
-- mitigation requires role separation (migration role with DDL, app role
-- without) — operationally documented in the deploy runbook, not enforced
-- via SQL.

CREATE OR REPLACE FUNCTION block_truncate_append_only() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% is append-only — TRUNCATE blocked', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER alert_evidence_no_truncate
    BEFORE TRUNCATE ON alert_evidence
    FOR EACH STATEMENT EXECUTE FUNCTION block_truncate_append_only();

CREATE TRIGGER alert_evidence_pending_no_truncate
    BEFORE TRUNCATE ON alert_evidence_pending
    FOR EACH STATEMENT EXECUTE FUNCTION block_truncate_append_only();

CREATE TRIGGER commit_failures_no_truncate
    BEFORE TRUNCATE ON alert_evidence_commit_failures
    FOR EACH STATEMENT EXECUTE FUNCTION block_truncate_append_only();

CREATE TRIGGER retractions_no_truncate
    BEFORE TRUNCATE ON retractions
    FOR EACH STATEMENT EXECUTE FUNCTION block_truncate_append_only();

-- Note: methodology_versions, engine_state_snapshot, and mcp_call_log are
-- intentionally NOT protected:
--   * methodology_versions: status mutations are expected (active→deprecated→broken)
--   * engine_state_snapshot: TRUNCATE is the documented manual reset path (ADR-0010)
--   * mcp_call_log: 90-day retention drops old rows via daily cron (ADR-0011)
