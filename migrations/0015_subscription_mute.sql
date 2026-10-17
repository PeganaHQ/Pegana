-- Add a soft-mute column to subscriptions. NULL = not muted; future
-- timestamp = muted until that moment. Used by /mute <asset> [duration]
-- without affecting is_active (which the user may later toggle via
-- /unsubscribe). Dispatcher filters out muted rows when matching alerts.

ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;

-- Btree on (asset, is_active) speeds up the dispatcher's per-alert
-- subscriber lookup. The muted_until check runs in the WHERE clause as
-- a filter — partial-index expressions cannot reference NOW() (not
-- IMMUTABLE), and a static "WHERE muted_until IS NULL" partial would
-- miss the common "muted yesterday, now expired" case.
CREATE INDEX IF NOT EXISTS subscriptions_asset_active_idx
    ON subscriptions (asset, is_active);
