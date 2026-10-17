-- Opt-in daily digest per user. Three columns on `users`:
--
--   digest_enabled       — TRUE after /digest on, FALSE after /digest off.
--   digest_hour_utc      — hour-of-day UTC (0..23) when this user receives
--                          their summary. Default 13 UTC = 09:00 ART /
--                          10:00 EST / 14:00 UTC+1, the broadest "morning
--                          on multiple continents" slot for the v1 audience.
--   digest_last_sent_at  — last successful send. The scheduler skips users
--                          whose last send was inside the current hour
--                          window, so a bot restart in the middle of the
--                          digest window can't double-send.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS digest_hour_utc SMALLINT NOT NULL DEFAULT 13
        CHECK (digest_hour_utc BETWEEN 0 AND 23),
    ADD COLUMN IF NOT EXISTS digest_last_sent_at TIMESTAMPTZ;

-- Hot-path index for the scheduler — small table (one row per Telegram user)
-- but the query runs every minute. The partial keeps it cheap as the
-- opt-in adoption rate grows.
CREATE INDEX IF NOT EXISTS users_digest_due_idx
    ON users (digest_hour_utc)
    WHERE digest_enabled = TRUE;
