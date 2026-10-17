-- alert_deliveries.acknowledged_at — admin-controlled ack flag for failed
-- deliveries. The /v1/stats banner counts failures with acknowledged_at IS
-- NULL only, so ops can mark known/resolved incidents and the dashboard
-- clears without waiting 24h for the row to age out of the rollup window.
--
-- Nullable + nullable default = no rewrite of existing rows; the ADD COLUMN
-- is metadata-only. Tested-against partition: alert_deliveries is not
-- partitioned (yet), so a plain ALTER TABLE is sufficient.
ALTER TABLE alert_deliveries
    ADD COLUMN acknowledged_at TIMESTAMPTZ,
    ADD COLUMN ack_reason TEXT;

-- Partial index so the /v1/stats banner query stays index-only. The
-- predicate matches the WHERE clause of the rollup; size stays small
-- because most rows are sent (not failed) and most failures will get
-- acknowledged over time.
CREATE INDEX IF NOT EXISTS alert_deliveries_unacked_failures_idx
    ON alert_deliveries (attempted_at DESC)
    WHERE status = 'failed' AND acknowledged_at IS NULL;

-- Auto-ack the two historical pre-fix MarkdownV2 escape failures from
-- 2026-05-25 14:13-14:14. Root cause shipped in commit fbd65cb (bot:
-- /send → parse_mode=HTML). Acknowledging them here so the dashboard
-- banner clears immediately on deploy; future failures (different cause)
-- stay un-acked until ops marks them.
UPDATE alert_deliveries
   SET acknowledged_at = NOW(),
       ack_reason      = 'pre-fix MarkdownV2 escape — resolved in commit fbd65cb (bot HTML parse_mode)'
 WHERE status     = 'failed'
   AND error      LIKE '%Character ''-'' is reserved%';
