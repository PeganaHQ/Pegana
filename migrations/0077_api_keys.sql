-- 0077: Machine API keys (rail B of the dual-rail spec — human API/dashboard).
--
-- A user issues keys from /account; each key is shown in full exactly once at
-- creation and only its SHA-256 hash is stored. `key_prefix` keeps the first
-- 8 chars of the plaintext so a key is identifiable in a list without ever
-- persisting the secret. `scopes` is a comma-separated capability string
-- (default `read`). `revoked_at` soft-deletes a key so usage history survives.
-- Per-key usage counters back the free tier (1,000 calls/mo) and credits
-- billing; `calls_month_reset_at` is the date the counter was last reset to.

CREATE TABLE IF NOT EXISTS api_keys (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              BIGINT       NOT NULL REFERENCES users(id),
    name                 TEXT         NOT NULL,
    key_prefix           TEXT         NOT NULL,
    key_hash             TEXT         NOT NULL UNIQUE,
    scopes               TEXT         NOT NULL DEFAULT 'read',
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_used_at         TIMESTAMPTZ,
    revoked_at           TIMESTAMPTZ,
    calls_this_month     INTEGER      NOT NULL DEFAULT 0,
    calls_month_reset_at DATE
);

CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON api_keys(user_id);
