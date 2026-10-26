# ADR 0011 — MCP `verify_alert` stays free, with rate limit + telemetry

**Status**: Accepted (2026-05-28)
**Context**: Trust Layer v0.1.0; MCP tool pricing consistency

## Problem

`verify_alert` is documented as free while other MCP tools
(`get_asset_state`, `get_assets`) charge $0.001/call via x402. Three
risks:

1. **Inconsistency**: agents wonder why some tools are free.
2. **No usage signal**: free tools give no on-chain settlement data,
   so you don't know who's verifying or how often.
3. **Abuse**: agents could poll `verify_alert` in tight loops.

## Decision

Keep `verify_alert` free per the existing rationale (verifying public
data should be costless to maximize trust signal), but add two
guardrails:

### Rate limit at MCP layer
- 100 calls/min per agent identity (grouped by x402 payment key fingerprint
  or, for free agents, by source IP).
- 429 with `Retry-After` on excess; cleanly surfaced as MCP tool error.

### Telemetry table
- New `mcp_call_log` table:
  ```sql
  CREATE TABLE mcp_call_log (
    id bigserial PRIMARY KEY,
    tool_name text NOT NULL,
    agent_fingerprint text,  -- nullable; not all callers identified
    called_at timestamptz NOT NULL DEFAULT now(),
    alert_id uuid,           -- nullable; only verify_alert sets it
    response_status smallint -- 200 / 404 / 429
  );
  CREATE INDEX mcp_call_log_called_at_idx ON mcp_call_log (called_at);
  ```
- All MCP tool calls (paid and free) log here in-band.
- Retained for 90 days; older data dropped via daily cron.
- Surfaced in Grafana as `mcp_calls_total{tool, status}` metric.

### Escape hatch
If abuse or cost analysis post-launch shows free is unsustainable, the
tool can flip to $0.0001/call (10× cheaper than paid tools) without
schema changes. Documented as "pricing may evolve" on the tool description.

## Why free + telemetry instead of paid

- The whole trust pitch is "anyone can verify"; charging adds friction
  exactly where you want zero friction.
- Telemetry gives you the signal you'd otherwise get from payment data,
  without the friction cost.
- Rate limit prevents pathological abuse without affecting legitimate use.

## Consequences

- +1 migration: `mcp_call_log` table.
- +1 task in Phase 6/7 (MCP server): rate limit middleware + call log
  middleware.
- +1 Grafana panel: `mcp_calls_total` by tool.
- Cost analysis at 06-25: if `verify_alert` calls/day × DB write cost
  > some threshold, revisit pricing.

## Cross-refs

- `docs/pegana-trust-layer-v0.1.0/08-external-surfaces.md § MCP`
- `docs/pegana-trust-layer-v0.1.0/plans/07-phase-6-7-bot-mcp.md`
- `docs/pegana-trust-layer-v0.1.0/11-observability.md`
