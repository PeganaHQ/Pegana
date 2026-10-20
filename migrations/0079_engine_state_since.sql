-- state_since = when the asset's last PUBLISHED state (discount_snapshots.state)
-- began, i.e. the first snapshot of the current contiguous run. Powers
-- GET /v1/assets/{symbol}/state `since` as an O(1) primary-key read instead of
-- a full-history scan of discount_snapshots (365-day retention, compressed
-- chunks). Distinct from band_since (0057): band_since follows the engine's
-- internal FSM, is reset to NULL by force_unknown, and drives the `sustained`
-- signal; state_since follows the published stream and is never reset.
--
-- Engine runtime cache, NOT a replay input (ADR-0010). Maintained by the
-- engine on a published-state change; the API falls back to the exact
-- discount_snapshots derivation when it is NULL, so it is safe to read before
-- the engine has stamped it.
ALTER TABLE engine_state_snapshot ADD COLUMN IF NOT EXISTS state_since TIMESTAMPTZ;

-- Backfill from history (one-off; same cost class as the 0057 backfill). The
-- current run starts at the first snapshot after the most recent row whose
-- state differs from the latest snapshot's state; an asset that has only ever
-- held one state starts at its first snapshot. NULL if it has no snapshots.
-- A separate column (not band_since) means a still-running pre-migration
-- engine cannot overwrite this value: its upsert never names the column.
UPDATE engine_state_snapshot e
SET state_since = (
    SELECT min(d.ts)
    FROM discount_snapshots d
    WHERE d.asset = e.asset
      AND d.ts > COALESCE(
            (SELECT max(x.ts)
             FROM discount_snapshots x
             WHERE x.asset = e.asset
               AND x.state IS DISTINCT FROM
                   (SELECT l.state FROM discount_snapshots l
                    WHERE l.asset = e.asset ORDER BY l.ts DESC LIMIT 1)),
            '-infinity'::timestamptz)
)
WHERE e.state_since IS NULL;

-- api-rs reads only the run start plus the freshness guard columns
-- (last_state, updated_at) used by GET /state (least-privilege roles, 0072).
-- Column-level grant so the API role never sees the engine's EWMA / hysteresis
-- internals.
GRANT SELECT (asset, state_since, last_state, updated_at) ON engine_state_snapshot TO pegana_api;
