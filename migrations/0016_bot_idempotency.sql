-- Per-alert idempotency guard for the dispatcher → bot /send path.
-- The dispatcher's exponential-backoff retry can land the same alert
-- twice when the first attempt succeeds Telegram-side but the HTTP
-- response is dropped (timeout, container restart, etc). Bot inserts
-- the dispatcher's idempotencyKey here on first delivery; on conflict
-- it short-circuits with a 200 OK without re-sending to Telegram.
--
-- A nightly cron (or just the TTL implied by expires_at) can clean
-- entries older than the dispatcher's max retry window (~5min × 3 attempts).

CREATE TABLE IF NOT EXISTS bot_idempotency (
    key        TEXT        PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bot_idempotency_expires_at_idx
    ON bot_idempotency (expires_at);
