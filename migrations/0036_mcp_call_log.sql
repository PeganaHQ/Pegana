-- migrations/0036_mcp_call_log.sql
--
-- MCP tool call telemetry per ADR-0011.
--
-- The verify_alert tool stays FREE (the trust pitch is "anyone can verify"
-- — charging adds friction exactly where you want zero), but free means
-- no on-chain settlement record to tell us who's calling. This table fills
-- that gap.
--
-- All MCP tool calls log here, paid (get_assets, get_asset_state) and
-- free (verify_alert), so we can:
--   * detect abusive polling (rate-limit middleware reads this)
--   * surface as Grafana metric `mcp_calls_total{tool, status}`
--   * decide on 06-25 whether free is sustainable or needs $0.0001/call
--
-- Retention: 90 days. Daily cron drops older rows (see runbook in Phase 12).
--
-- ADR reference: docs/adr/0011-mcp-verify-alert-free-with-telemetry.md

CREATE TABLE mcp_call_log (
    id                BIGSERIAL   PRIMARY KEY,
    tool_name         TEXT        NOT NULL,

    -- x402 payment-key fingerprint for paid tools; source IP hash (or NULL)
    -- for free tools. Group-by this for per-agent rate limiting.
    agent_fingerprint TEXT,

    called_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Set only by verify_alert; NULL for tools that don't reference a specific alert.
    alert_id          UUID,

    -- HTTP-like response status. 200 success, 404 not found, 429 rate-limited.
    response_status   SMALLINT    NOT NULL
);

-- Hot path: rate-limit middleware needs recent calls per agent fingerprint.
CREATE INDEX idx_mcp_call_log_recent ON mcp_call_log (called_at DESC);
CREATE INDEX idx_mcp_call_log_agent_recent
    ON mcp_call_log (agent_fingerprint, called_at DESC)
    WHERE agent_fingerprint IS NOT NULL;

COMMENT ON TABLE mcp_call_log IS
    'MCP tool call telemetry. Retention: 90 days (daily cron drops older). '
    'Surfaced as Grafana mcp_calls_total{tool, status}. Cost-analysis trigger '
    'at 2026-06-25 decides whether verify_alert stays free or flips to '
    '$0.0001/call (per ADR-0011 escape hatch).';
