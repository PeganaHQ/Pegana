-- 0046: webhook channel types (generic | discord | slack).
--
-- Pegana sent every webhook as generic signed JSON, which Discord/Slack
-- reject (they require channel-shaped bodies: Discord `embeds`/`content`,
-- Slack `attachments`/`text`). This column lets the dispatcher + api render
-- per destination. Default 'generic' keeps every existing machine receiver
-- byte-for-byte unchanged.

ALTER TABLE webhook_subscriptions
    ADD COLUMN IF NOT EXISTS channel_type TEXT NOT NULL DEFAULT 'generic';

ALTER TABLE webhook_subscriptions
    DROP CONSTRAINT IF EXISTS webhook_subscriptions_channel_type_chk;
ALTER TABLE webhook_subscriptions
    ADD CONSTRAINT webhook_subscriptions_channel_type_chk
    CHECK (channel_type IN ('generic', 'discord', 'slack'));

-- Best-effort backfill so already-registered Discord/Slack hooks start
-- working on deploy. The LIKE matching is coarser than the Rust detector
-- (host parsing in SQL is approximate); any miss is correctable via
-- PATCH /v1/me/webhooks/{id}, and every NEW registration uses the exact
-- Rust detect_channel_type().
UPDATE webhook_subscriptions
   SET channel_type = 'discord'
 WHERE channel_type = 'generic'
   AND (url LIKE 'https://discord.com/%'
     OR url LIKE 'https://discordapp.com/%'
     OR url LIKE 'https://%.discord.com/%'
     OR url LIKE 'https://%.discordapp.com/%');

UPDATE webhook_subscriptions
   SET channel_type = 'slack'
 WHERE channel_type = 'generic'
   AND (url LIKE 'https://hooks.slack.com/%'
     OR url LIKE 'https://%.slack.com/%');
