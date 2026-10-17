-- Add a nullable source column to users for attribution from web → bot
-- deep links (?start=src_<page>[_<asset>] payload). The bot writes this
-- only on first insert; existing users keep NULL.

ALTER TABLE users ADD COLUMN IF NOT EXISTS source TEXT;
