# Discord adapter — v1.3

**Status:** spec, queued behind production deploy
**Priority:** HIGH — doubles addressable TAM. Many DeFi communities live in Discord.

## Goal

Let users receive Pegana alerts in a Discord channel (server or DM) by linking
their Pegana account to a Discord webhook URL OR by inviting a Pegana Discord
bot to their server.

## Decision: webhook URL first, full bot later

Webhooks are 5 lines of Discord setup for any server admin. A full Discord bot
needs application setup, slash command registration, OAuth installation, per-
server permissions — 1-2 weeks of work. Webhook unlocks 90% of value in 1 day.

## Architecture (webhook v1)

```
Existing dispatcher
  │
  ├─→ TG: bot.api.sendMessage         (current)
  └─→ Discord: POST <webhook_url>     (new)
```

### DB

Reuse `subscriptions.channel` enum already in code. Add `'discord'` value.

```sql
ALTER TABLE subscriptions ADD COLUMN discord_webhook_url TEXT;
-- Discord webhook URLs are inherently secret (anyone with URL can post)
-- but they're scoped to a single channel so leakage damage is limited.
-- Encrypt at rest with master key.
```

### Endpoints

```
POST /v1/me/discord                 { webhook_url, asset, threshold_bps }
   - Validates URL matches https://discord.com/api/webhooks/...
   - POSTs a test message ("Pegana connected ✓") to verify URL works
   - Creates subscription with channel='discord'

DELETE /v1/me/discord/:id
```

### Dispatcher

```rust
match sub.channel.as_str() {
    "telegram" => send_telegram(alert, sub.user).await,
    "discord"  => send_discord(alert, &sub.discord_webhook_url).await,
    _ => Err(anyhow!("unknown channel")),
}
```

Discord message format (rich embed):

```json
{
  "embeds": [{
    "title": "jitoSOL · DRIFT",
    "description": "Discount 0.72% — intrinsic 189.42 vs market 188.06",
    "color": 12613205,   // sunset orange
    "fields": [
      { "name": "From", "value": "PEGGED", "inline": true },
      { "name": "To",   "value": "DRIFT",  "inline": true },
      { "name": "Confidence", "value": "high", "inline": true }
    ],
    "footer": { "text": "Pegana — pegana.xyz/asset/jitoSOL" },
    "timestamp": "2026-05-25T20:42:00Z"
  }]
}
```

### Rate limit

Discord webhooks: 30 messages / 60s per webhook. Dispatcher batches per webhook
URL with grammY-style flood-wait handling (`429 Retry-After` header).

## Frontend

`/account/channels` page (new) — replaces dedicated `/account/discord`. Lists
all delivery channels (TG, Discord, future webhook) with add/test/remove
actions per channel.

Or simpler: extend `/account` Profile page with a "Channels" section. Defer
the dedicated page until 3+ channels exist.

## Effort estimate

- Backend: 1d (schema + endpoint + dispatcher adapter + test)
- Frontend: 0.5d (UI to paste webhook URL + test connection)
- Validation: 0.5d (smoke against real Discord webhook in dogfood server)

**Total: 2 days.**

## Trigger conditions

Ship when ANY of:
- Hetzner deploy is live + dogfood proves stability (post-launch +1 week)
- A user explicitly asks for Discord
- We're ready to announce v1.2 "now in Discord"

## Out of scope (v1)

- Full Discord bot (slash commands, server permissions, ephemeral replies)
  — defer to v1.4 or later
- Discord OAuth user identity (would let us tie Discord user to Pegana
  account natively; webhook approach skips this)
- Public Pegana Discord server (separate community-building work, not feature)
