-- migrations/0039_retractions_partial_immutability.sql
--
-- Closes the UPDATE bypass on the retractions audit table.
--
-- Wave 13C audit B P2 flagged a gap: migration 0032 created `retractions`,
-- and 0037 added a BEFORE TRUNCATE trigger, but no UPDATE-guard exists.
-- That leaves the four "audit" columns (methodology_version, retracted_at,
-- reason, fix_url) silently rewritable by any role with table-level
-- UPDATE privileges. ADR-0003 frames retractions as an append-only,
-- forever-auditable record — a post-hoc UPDATE on `reason` or `fix_url`
-- would let an operator quietly rewrite history without surfacing it in
-- the timeline.
--
-- Fix: split the columns into two groups and let UPDATEs through only on
-- the operational counters that the dispatcher legitimately mutates as
-- it fans out a retraction signal.
--
--   audit-immutable (UPDATE blocked):
--     - methodology_version  (the broken version pointer; primary key)
--     - retracted_at         (the timestamp of the retraction event)
--     - reason               (the bug identifier surfaced to users)
--     - fix_url              (the diff / PR link to the patch)
--
--   operationally-mutable (UPDATE allowed):
--     - onchain_tx_sig       (filled in once the memo tx lands)
--     - webhook_refire_count (incremented by the dispatcher fan-out)
--     - bot_refire_count     (incremented by the bot retraction worker)
--
-- DELETE remains blocked by the absence of a DELETE policy on this table
-- (only TRUNCATE was explicitly forbidden in 0037); operationally we
-- rely on role separation — the app role has no DELETE grant on
-- retractions — same posture as alert_evidence.
--
-- Reference: docs/adr/0003-methodology-retraction-protocol.md

CREATE OR REPLACE FUNCTION retractions_partial_immutable() RETURNS TRIGGER AS $$
BEGIN
    -- IS DISTINCT FROM is NULL-safe (NULL = NULL evaluates NULL not TRUE
    -- in standard SQL); we want NULL <-> non-NULL transitions to count
    -- as a change too, hence IS DISTINCT FROM rather than `=` / `<>`.
    IF NEW.methodology_version IS DISTINCT FROM OLD.methodology_version THEN
        RAISE EXCEPTION 'retractions.methodology_version is immutable (ADR-0003)';
    END IF;
    IF NEW.retracted_at IS DISTINCT FROM OLD.retracted_at THEN
        RAISE EXCEPTION 'retractions.retracted_at is immutable (ADR-0003)';
    END IF;
    IF NEW.reason IS DISTINCT FROM OLD.reason THEN
        RAISE EXCEPTION 'retractions.reason is immutable (ADR-0003)';
    END IF;
    IF NEW.fix_url IS DISTINCT FROM OLD.fix_url THEN
        RAISE EXCEPTION 'retractions.fix_url is immutable (ADR-0003)';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER retractions_no_audit_mutation
    BEFORE UPDATE ON retractions
    FOR EACH ROW EXECUTE FUNCTION retractions_partial_immutable();
