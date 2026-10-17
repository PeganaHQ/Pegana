-- Persist grammY session state across bot container restarts. Previously
-- the bot used MemorySessionStorage, so a redeploy reset every user's
-- in-flight session (most visibly: the i18n locale, which falls back to
-- pt-BR until the next /lang). Replace with a Postgres-backed
-- StorageAdapter — small JSONB table keyed by grammY's per-chat key.

CREATE TABLE IF NOT EXISTS bot_sessions (
    key        TEXT        PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lets a future janitor cron drop sessions whose users haven't messaged the
-- bot in N days. Cheap insurance now; avoids reindexing once the table grows.
CREATE INDEX IF NOT EXISTS bot_sessions_updated_at_idx
    ON bot_sessions (updated_at);
