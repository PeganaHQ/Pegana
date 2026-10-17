# Production deploy plan — v1.x

**Status:** spec, blocked on user kicking off Hetzner provision
**Target:** v1.1.x in prod within 1 weekend of execution

## Topology

```
  pegana.xyz                    api.pegana.xyz
       │                              │
   Vercel CDN                  Hetzner CAX21 (ARM)
   (web only)                  ┌──────────────┐
       │                       │ Caddy 2      │ — auto TLS, WS upgrade
       │                       ├──────────────┤
       │                       │ api-rs       │ — :8080
       │                       │ indexer-rs   │
       │                       │ engine-rs    │
       │                       │ dispatcher-rs│
       │                       │ bot-ts       │ — :3000 (internal)
       │                       ├──────────────┤
       │                       │ Postgres+TS  │ :5432 (internal)
       │                       │ Redis        │ :6379 (internal)
       │                       └──────────────┘
       │
       └─→ fetches HTTPS to api.pegana.xyz (CORS allow_origin Any)
```

## Hetzner (api + workers + DB)

- **VPS:** CAX21 ARM (4 vCPU Ampere · 8GB · 80GB SSD · 20TB · €7.99/mo)
- **OS:** Ubuntu 24.04 LTS, location Falkenstein
- **Provisioning:** SSH harden (no root pw, fail2ban, ufw 22/80/443), Docker + compose v2
- **DNS:** Cloudflare A record `pegana.xyz` → Vercel; `api.pegana.xyz` → Hetzner IP **proxy off** (so WS works direct)
- **TLS:** Caddyfile already configured for `api.pegana.xyz` → auto Let's Encrypt
- **Deploy:** `git pull && docker compose up -d --build`
- **Env on box:** `/opt/pegana/.env` from local 1Password (BOT_TOKEN, BOT_INTERNAL_SECRET, JWT_SECRET, WEB_BASE_URL=https://pegana.xyz, SENTRY_DSN if set)
- **Backups:** `pg_dump | gzip > /backups/` daily cron, push to Cloudflare R2 via rclone
- **Restore drill:** spin up 2nd VPS, restore latest dump, smoke `/healthz`
- **Monitoring:** Sentry DSN per service, Prometheus scrape, Grafana Cloud free tier, UptimeRobot external `/healthz`

## Vercel (web only)

- **Repo:** `lrafasouza/pegana`, root = `web/`
- **Framework:** Next.js (auto-detected, Turbopack)
- **Env (Production):**
  ```
  NEXT_PUBLIC_API_BASE=https://api.pegana.xyz
  NEXT_PUBLIC_WS_URL=wss://api.pegana.xyz/v1/ws
  NEXT_PUBLIC_BOT_USERNAME=PeganaWatchBot
  ```
- **Env (Preview):** same but `NEXT_PUBLIC_API_BASE` points to a staging API if one exists; otherwise same as prod (read-only is safe)
- **Custom domain:** `pegana.xyz` and `www.pegana.xyz` (302 www → root)
- **Build cmd:** `next build` (default)
- **Output:** standalone (default Vercel)

## Telegram

- **BotFather:** `/setdomain` for `@PeganaWatchBot` → `pegana.xyz` (definitivo, fim do túnel cloudflared)
- **BotFather:** `/setcommands` (already in code, re-runs on bot boot via `registerCommands()`)
- **Optional:** `@PeganaDevBot` separate handle for dev with `/setdomain` = whatever cloudflared spits out. Then `.env.dev` has its token + `NEXT_PUBLIC_BOT_USERNAME=PeganaDevBot`. Cleanest split.

## Sequence

1. Provision Hetzner CAX21, harden, install Docker
2. Point `api.pegana.xyz` A record at Hetzner IP (Cloudflare, proxy off)
3. `git clone` + `.env` from secrets → `docker compose up -d`
4. Smoke `https://api.pegana.xyz/healthz` (Caddy will negotiate cert in ~30s)
5. Connect Vercel to repo, set envs, deploy
6. Point `pegana.xyz` to Vercel (CNAME or Vercel-managed A)
7. BotFather `/setdomain pegana.xyz`
8. End-to-end smoke from production URL: sign in → create sub → `/list` in bot → verify

## Cost

- Hetzner: €7.99/mo (~$8.50)
- Vercel: $0 (Hobby free for solo project under fair use)
- Cloudflare DNS: $0
- Cloudflare R2 backups: $0.015/GB/mo (<$0.50 for years)
- Grafana Cloud: $0 (free tier 10k metrics)
- UptimeRobot: $0 (free 5min checks)
- Sentry: $0 (free 5k events/mo, fine for v1)

**Total: ~$9/mo all-in.**

## Risks

| Risk | Mitigation |
|---|---|
| `JWT_SECRET` rotation invalidates sessions | Acceptable — users re-login via 1 Telegram tap |
| Hetzner provider failure | Postgres dump on R2; 2nd VPS restorable in <30min |
| Vercel build break (Next 16 quirks) | Smoke locally with `bun run build` before push; revert easy |
| Bot token leak | Stored only in `.env` (gitignored) + 1Password; rotate via @BotFather, redeploy |
| CORS misconfig | api-rs sets `allow_origin(Any)` for GET; tightening to `https://pegana.xyz` in v1.2 once login flow is stable |

## Out of scope (this deploy)

- Multi-region (single Hetzner box is enough for thousands of dogfood users)
- Read replicas for Postgres
- CDN for /v1/assets (no point — 5KB JSON, refreshed every 30s on client)
- Webhook channel (separate spec — see `2026-05-25-webhook-channel.md`)
- Discord adapter (separate spec — see `2026-05-25-discord-adapter.md`)

## Verification checklist (post-deploy)

- [ ] `curl https://api.pegana.xyz/healthz` → 200
- [ ] `curl https://api.pegana.xyz/v1/stats` → JSON
- [ ] `https://pegana.xyz/dashboard` renders, /v1/assets call succeeds
- [ ] `/v1/ws` accepts wss:// upgrade
- [ ] Sign in via `pegana.xyz/account` succeeds
- [ ] Bot `/web` returns button with `https://pegana.xyz/account/subscriptions`
- [ ] No `localhost` references in any rendered HTML, env, or bot reply
