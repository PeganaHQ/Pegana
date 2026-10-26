-- Small bot-owned key/value store for runtime coordination.
--
-- First use: cache the Telegram command-menu payload hash so restarts do not
-- call setMyCommands/setChatMenuButton on every boot and burn Telegram's
-- global menu-registration rate limit.

CREATE TABLE IF NOT EXISTS bot_runtime_kv (
    key        TEXT        PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
