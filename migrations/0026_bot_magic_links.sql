-- One-shot, short-lived nonces minted by the bot so a Telegram user can
-- land on the web console already authenticated.
--
-- Flow:
--   1. Bot's /web command calls POST /v1/auth/magic/mint (internal-secret
--      protected). API inserts a row with a 32-byte random `nonce` and a
--      15-minute `expires_at`.
--   2. Bot renders an inline button to ${WEB_BASE_URL}/auth/magic?nonce=…
--   3. User taps. Web client POSTs the nonce to /v1/auth/magic/consume.
--   4. API atomically marks `consumed_at = NOW()` (returning the row) and
--      mints a regular 7-day session JWT — same path as Login Widget.
--
-- Security properties:
--   - nonce is 32 bytes of CSPRNG entropy → 256 bits, infeasible to guess
--     inside the 15-minute window.
--   - consumed_at is updated in the same UPDATE that selects the row, so
--     the second consumer of the same nonce reads zero rows back.
--   - expires_at enforces a hard ceiling; the janitor sweeps rows past
--     their expiry to keep the table bounded.

CREATE TABLE IF NOT EXISTS bot_magic_links (
    nonce       TEXT        PRIMARY KEY,
    telegram_id BIGINT      NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Used by the janitor sweep; also covers the "find live nonces for user"
-- query if we ever want to revoke a specific user's pending links.
CREATE INDEX IF NOT EXISTS bot_magic_links_expires_idx
    ON bot_magic_links (expires_at)
    WHERE consumed_at IS NULL;
