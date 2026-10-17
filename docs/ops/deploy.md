# Deploying Pegana (self-hosted)

Pegana ships as a docker compose stack: Postgres 16 (TimescaleDB) + Redis, four Rust
services (indexer, engine, dispatcher, api), one TS service (mcp), and the optional
protocol indexer. The web console is a separate Next.js app (see `web/`).

## Prerequisites

- A Linux box (2 vCPU / 8 GB RAM is enough for the full stack) with Docker Engine,
  the compose plugin, git, and rclone (only if you configure R2 backups)
- A Solana mainnet RPC endpoint (any provider; set `SOLANA_RPC_URL` and optionally
  `SOLANA_RPC_URL_FALLBACK`)
- API keys for the data sources you want (Jupiter quotes, Sanctum LST registry —
  see `.env.example` for the full list; every source degrades gracefully)

## Steps

1. Clone the repo on the box and create your `.env` from `.env.example`.
   Never commit the real `.env`.
2. Apply the database migrations once:
   `sqlx migrate run --source migrations` against your Postgres
   (`DATABASE_URL=postgres://user:pass@host:5432/pegana`).
3. `docker compose up -d --build` (first build is a full Rust release build;
   expect 30–60 min on a 2-vCPU box).
4. Smoke: `curl localhost:8080/health` → `{"ok":true}` and
   `curl localhost:8080/v1/assets | jq .count`.
5. Put a TLS terminator (Caddy/nginx) in front of the api port. The API is
   public and rate-limited; no auth surface exists to configure.

## Operational notes

- `assets.toml` is the canonical asset registry; `cargo xtask verify-assets`
   validates mints against your RPC before you rely on them.
- Backups: adapt `scripts/pg-backup.sh` (rclone-based) to your object storage.
- Everything is free and unauthenticated by design. Rate limits live in the
  api service configuration.

## Updating

`git pull && docker compose up -d --build <service>` rebuilds incrementally.
Migrations are additive; `sqlx migrate run` before rolling new code.
