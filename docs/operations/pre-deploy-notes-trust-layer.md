# Trust Layer pre-deploy notes

## alert_events view check (2026-05-28)

- **Status before fix**: MISSING (only `discount_1m` view existed in prod)
- **Impact**: MCP `subscribe_peg_events` was broken — all `FROM alert_events`
  queries returned `relation does not exist`. Affected calls were silently
  failing (or returning errors to the agent caller) since at least 2026-05-27
  (first verified absence).
- **Action**: Applied migration `0029_alert_events_view.sql` out-of-band on
  2026-05-28 ~17:50 UTC. Idempotent `CREATE OR REPLACE VIEW`. No data
  migration; view is a SELECT over the existing `alerts` table.
- **MCP smoke test**: Query equivalent to
  `mcp-ts/src/tools/subscribe-peg-events.ts:106` returned 2 rows
  (USDC alerts). PASS.
- **Migration file**: `migrations/0029_alert_events_view.sql` (committed on
  branch `feat/trust-layer-v0.1.0`).

## Acceptance criterion AC80

- ✅ View exists on prod with columns `id, asset, from_state, to_state, discount, ts`.
- ✅ Migration codified in repo.
- ✅ Smoke test passed.
