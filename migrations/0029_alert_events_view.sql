-- Codify alert_events view consumed by mcp-ts/src/tools/subscribe-peg-events.ts.
-- Idempotent — safe to re-run on environments where the view already exists.
-- Source: alerts table. Update this view when column semantics change.

CREATE OR REPLACE VIEW alert_events AS
SELECT
    id,
    asset,
    from_state,
    to_state,
    discount,
    detected_at AS ts
FROM alerts;

COMMENT ON VIEW alert_events IS
    'Backward-compat view consumed by mcp-ts/src/tools/subscribe-peg-events.ts. '
    'Source: alerts table. Update this view when column semantics change.';
