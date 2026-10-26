-- migrations/0038_webhook_deliveries_alert_id_idx.sql
--
-- Index on webhook_deliveries.alert_id for the ADR-0003 retraction worker.
--
-- The worker's affected-subs query joins webhook_deliveries ⋈ alert_evidence
-- on alert_id. webhook_deliveries already has a composite index
-- (subscription_id, attempted_at DESC) but no index on alert_id alone,
-- which forces a seq scan on the JOIN during retraction fan-out — fine at
-- v0.1.0 scale (~100 deliveries) but becomes the bottleneck once the
-- table grows (every alert × every subscriber × retry attempts).
--
-- IF NOT EXISTS: idempotent for environments where someone already added
-- this index out-of-band.
--
-- Wave 5 review (/review-and-iterate) flagged this as P3-C.

CREATE INDEX IF NOT EXISTS webhook_deliveries_alert_id_idx
    ON webhook_deliveries (alert_id);
