-- v1.1 Console — registry of issued JWT web sessions.
--
-- JWT itself is stateless (HS256, claim sub=telegram_id), but we record jti so
-- /logout can revoke before exp and audits can list active sessions per user.
-- expires_at mirrors the JWT exp claim — a janitor cron (future) deletes rows
-- past expiry.

CREATE TABLE IF NOT EXISTS web_sessions (
    jti          UUID         PRIMARY KEY,
    telegram_id  BIGINT       NOT NULL,
    issued_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ  NOT NULL,
    revoked_at   TIMESTAMPTZ,
    user_agent   TEXT,
    ip           INET
);

CREATE INDEX IF NOT EXISTS web_sessions_user_idx
    ON web_sessions(telegram_id);
CREATE INDEX IF NOT EXISTS web_sessions_expires_idx
    ON web_sessions(expires_at)
    WHERE revoked_at IS NULL;
