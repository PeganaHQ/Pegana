# Telegram Mini App — v1.4

**Status:** spec, deferred until mobile usage justifies
**Priority:** LOW (right now) → HIGH if 60%+ of traffic is mobile

## Goal

Embed a stripped Pegana dashboard inside the Telegram client (mobile + desktop)
so users manage subscriptions without leaving Telegram. Mini Apps render in a
WebView inside Telegram with native-feeling chrome.

## Why deferred

- Login Widget covers ~95% of cases — users have a path today
- Building Mini App = duplicate UI surface to maintain (or careful sharing)
- Mobile-first justification needs data we don't have yet (Plausible/PostHog)
- Telegram Mini App ecosystem still evolving; spec might shift

## Trigger conditions

Ship when ANY of:
- 60%+ of /account traffic comes from mobile (measure post-launch with Plausible)
- 3+ users explicitly request a "mobile experience"
- We're courting a partner that requires Mini App distribution

## Design when triggered

### Architecture

Mini App is a regular Next.js route at `pegana.xyz/app` (or subdomain
`app.pegana.xyz`). Telegram bot opens it via:

```ts
bot.command("app", async (ctx) => {
  await ctx.reply("Open Pegana", {
    reply_markup: {
      inline_keyboard: [[{
        text: "Open mini app",
        web_app: { url: "https://pegana.xyz/app" },
      }]],
    },
  });
});
```

User taps button → Telegram opens WebView with our /app route → page detects
Telegram context via `window.Telegram.WebApp` SDK → auto-authenticates using
`initData` (signed by Telegram, validated server-side).

### Auth path

`POST /v1/auth/miniapp` (new) — validates `initData` via HMAC against
SHA256(BOT_TOKEN) — same pattern as Login Widget but different signing input
(`hash` parameter in `initData` query string). Issues same JWT as `/v1/auth/telegram`.

### UI scope

- Dashboard (read-only, top 5 movers)
- /account/subscriptions (slider + add)
- /account/alerts (last 10)
- No /developers, /oracle, /methodology — those make no sense in 320px WebView

### Reuse

- All `/v1/me/*` endpoints reused as-is
- Components: AccountSidebar replaced by Telegram BottomBar (built into Mini App SDK)
- SubscribeModal reused (Telegram WebApp respects normal HTML dialogs)

## Effort estimate

- Backend: 0.5d (`/v1/auth/miniapp` endpoint, validates initData)
- Frontend: 3d (separate route group `/app/*`, simplified components, BottomBar nav, Telegram theme integration)
- Telegram setup: 0.5d (@BotFather → /newapp, configure URL, icon)
- Testing: 1d (real Telegram client, mobile + desktop variants)

**Total: 5 days.**

## Out of scope

- Native iOS/Android app (Mini App is the native-feel without the app store)
- Push notifications outside Telegram chat (TG handles all push)
- In-Mini-App payments (Telegram Stars) — defer until premium tier exists
