-- Per-user timezone for the daily digest.
--
-- Before this migration, `digest_hour_utc` was interpreted as an absolute
-- UTC hour, which biased every non-UTC user (a Brazilian who wanted "10am
-- local" had to know that's 13:00 UTC and remember to shift on DST events
-- in regions that observe it). This column lets each user nominate the
-- IANA timezone their `digest_hour_utc` should be interpreted in.
--
-- The column name `digest_hour_utc` is preserved for ABI stability — it
-- now semantically means "hour-of-day in `digest_tz`". The bot validates
-- IANA names against `pg_timezone_names` before writing; we don't enforce
-- a CHECK constraint here because that catalog is mutable across Postgres
-- versions and we don't want migration brittleness.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS digest_tz TEXT NOT NULL DEFAULT 'UTC';
