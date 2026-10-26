-- 0078: Per-day API key usage (rail B usage instrumentation, F3.1).
--
-- `api_keys.calls_this_month` (0077) is a single rolling counter — enough to
-- enforce the free tier, but it cannot answer "how much did this key call last
-- week?" which the /account usage dashboard needs. This table keeps one row per
-- (calendar day, key) so `GET /v1/me/usage` can plot the last 30 days.
--
-- Upserted best-effort by the `X-API-Key` auth path right next to the existing
-- `calls_this_month` bump (`crates/api-rs/src/auth/api_key.rs::record_usage`),
-- on the same session-timezone `CURRENT_DATE` basis as the monthly counter's
-- `date_trunc('month', now())::date`, so a day and the month it belongs to
-- never disagree. Rows are historical telemetry — never read by the engine or
-- a receipt, no methodology impact.
--
-- ON DELETE CASCADE: keys are only ever soft-revoked (`revoked_at`), so this
-- fires almost never — but it keeps a hard delete of a key (test cleanup,
-- operator surgery) from stranding orphaned usage rows.

CREATE TABLE IF NOT EXISTS api_key_daily_usage (
    day         DATE    NOT NULL,
    api_key_id  UUID    NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    calls       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, api_key_id)
);

-- The usage endpoint reads a single key's recent series ordered by day; the
-- PK already covers (day, api_key_id) lookups, this covers the per-key scan.
CREATE INDEX IF NOT EXISTS api_key_daily_usage_key_day_idx
    ON api_key_daily_usage (api_key_id, day DESC);
