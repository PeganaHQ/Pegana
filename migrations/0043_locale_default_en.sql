-- 0043_locale_default_en.sql
-- Bot is EN-only (ADR-0022, supersedes ADR-0012 bot scope). The original
-- default was 'pt-BR' (0001_initial.sql:133) while the bot already negotiated
-- to 'en' — this closes that mismatch. users.locale is now vestigial (the
-- renderer ignores it), so normalise every row to 'en': this migrates the
-- historical 'pt-BR'/'pt' rows and any stray 'en-US' an early upsert stored.
ALTER TABLE users ALTER COLUMN locale SET DEFAULT 'en';
UPDATE users SET locale = 'en' WHERE locale <> 'en';
