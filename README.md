# Pegana

> **Peg-risk oracle for Solana** — early-warning system for Liquid Staking Tokens and stablecoins on Solana.

[![status](https://img.shields.io/badge/status-Technical%20Preview-brightgreen.svg)](https://pegana.xyz)
[![rust](https://img.shields.io/badge/rust-1.90-orange.svg)](rust-toolchain.toml)
[![methodology](https://img.shields.io/badge/methodology-0.8.0-blue.svg)](https://crates.io/crates/pegana-methodology)
[![cli](https://img.shields.io/badge/pegana--replay-0.6.1-blue.svg)](https://crates.io/crates/pegana-replay)

Pegana is the **specialized peg-risk oracle for Solana**. It monitors the divergence between the **intrinsic value** (what an asset *should* be worth, based on its peg mechanism) and the **market value** (what you'd actually get swapping it right now) for **66 assets on the public peg surface** on Solana mainnet — the live list is always [`GET /v1/assets`](https://api.pegana.xyz/v1/assets). When the gap exceeds per-asset thresholds, Pegana publishes the transition via REST, WebSocket and MCP, and emits a reproducible audit receipt.

**V1 — live in production since 2026-07-23** (methodology **0.8.0**; product status: **Technical Preview**): every state transition emits a public receipt at `/v1/audit/{id}` with the methodology version, frozen inputs, and an optional on-chain commit via a Solana SPL Memo (see ADR-0004). Receipts are reproducible offline via the [`pegana-replay`](crates/pegana-replay-cli/) CLI (`--json` for machine-readable CI output) — verification is exact-match per ADR-0028, so always install with `--locked`:

```sh
cargo install pegana-replay --locked
pegana-replay --alert-id <uuid>          # recomputes the hash + checks the on-chain anchor
```

**Typed clients**: [`sdk/typescript`](sdk/typescript/) (`@peganahq/sdk-ts`) and [`sdk/python`](sdk/python/) (`pegana-sdk`) cover **every** `/v1` endpoint (generated from the OpenAPI 3.1 spec at `GET /openapi.json`), plus a hand-written live-feed WebSocket helper (`PegFeed` / `peg_feed`) for `GET /v1/ws`. The current release is 0.4.0 on npm and PyPI (published 2026-10-25), which drops the removed `/v1/alerts`, `/v1/auth/*` and `/v1/me/*` calls; earlier releases (npm 0.3.1, PyPI 0.3.0) still include them.

## What it covers (v2)

**43 Liquid Staking Tokens** — SOL-pegged, priced off stake-pool NAV via Sanctum's SOL-value calculator, direct SPL-stake-pool reads (`jitoSOL`), and Hylo (`hyloSOL`, `hyloSOL+`). e.g. `jitoSOL` · `mSOL` · `bSOL` · `INF` · `JupSOL` · `BNSOL` …

**10 Yield-bearing stables** — peg-to-NAV, not peg-to-$1 (NAV grows as the strategy earns)
`USDY` (Ondo · T-bills) · `sUSD` (Solayer · Token-2022 rebasing) · `syrupUSDC` (Maple) · `sUSDe` (Ethena) · `ONyc` (OnRe · reinsurance) · `JLP` (Jupiter LP) · `eHYUSD` (Hylo Earn pool — API symbol `sHYUSD`) …

**7 Fiat stables**, pegged to $1 via different mechanisms
`USDC` · `USDT` · `PYUSD` · `USDG` · `USD1` · `USDu` · `CASH`

**3 delta-neutral** (`USDe` · `JupUSD` · `USX`) · **2 CDP** (`USDS` · `hyUSD`) · **1 FX** (`EURC`)

Not on the peg surface: **`xSOL`** (Hylo's leveraged junior tranche) is tracked internally but excluded from `/v1/assets`, `/v1/peg/feed`, `/v1/stats` and `/v1/calibration` since 2026-07-23 — a leveraged tranche trades 60–85% away from its own NAV *by design*, so "market vs intrinsic" measures leverage, not peg deviation.

**66 assets on the public peg surface** (the number every user-facing surface reports; [`GET /v1/calibration`](https://api.pegana.xyz/v1/calibration) has the current calibrated/provisional split). The authoritative, always-current list is [`assets.toml`](assets.toml) and the live [`GET /v1/assets`](https://api.pegana.xyz/v1/assets). Deactivated entries — e.g. `dSOL` (after the 2026-04-01 Drift exploit) and `BRZ` (thin market liquidity) — stay in `assets.toml` with `active = false` for historical snapshots.

Per-asset peg mechanisms drive per-asset intrinsic calculation: fiat-backed assets peg to $1, LSTs read Sanctum's SOL-value calculator, hyUSD computes its collateral ratio from on-chain Hylo Exchange state, and yield-bearing stables consume issuer-attested NAV (Pyth Redemption Rate feeds, or the Token-2022 rebasing rate for `sUSD`).

## Systemic Impact (Sub-C Loop Intelligence)

Pegana also tracks **cross-protocol leverage cascade risk** — the "Chaos Labs for Solana" feature (ADR-0036). The `protocol-indexer-ts` service polls Kamino and Jupiter Lend for **anonymous, aggregate** leverage exposure (never per-wallet; k-anonymity k>=5). `GET /v1/assets/{symbol}/loop-exposure` and `GET /v1/assets/{symbol}/simulate-depeg?shock_bps=` expose the cascade simulation (for example, `GET /v1/assets/JupSOL/simulate-depeg?shock_bps=1000` returns the live `liquidatable_usd` estimate for a 10% JupSOL depeg, and each response reports its own `coverage`). Surfaces on the `/asset` Overview tab ("Systemic impact" stress ladder) and the `/systemic` page. Advisory only — walled off from the verifiable receipt.

## Architecture

7 services + 2 stateful (Postgres + Redis), all in Docker Compose.

```
External APIs ─┐
               │     ┌──── indexer-rs ─────┐         ┌── protocol-indexer-ts ──┐
Sanctum ───────┤     │  (12 tokio tasks)   │         │  Kamino + Jupiter Lend │
Jupiter  ──────┼────▶│  Pyth SSE · Sanctum │─▶ PG    │  (leverage + HF cascade)│─▶ PG
Pyth     ──────┤     │  Jupiter · Hylo ·   │  (Timescale) └────────────────────────┘
DexScreener ───┤     │  SPL-stake · Perena │─▶ Redis
Public RPC ────┘     │  DexScreener · +6   │  pub/sub
                      └─────────────────────┘
                                 │
                      ┌──────────┴──────────┐
                      │                     │
                   engine-rs            dispatcher-rs
                   discount engine      alert fan-out
                   state machine            │
                      │                     │
                      └──────┬──────────────┘
                             │
               ┌─────────────┴─────────────┐
               │                           │
           api-rs                      mcp-ts
           REST + WS                   MCP
           public                      free tools
```

The full design specification is maintained privately.

## Quick start (dev local)

```bash
# Prereqs: Rust 1.90, Node 22+, Docker, Bun or pnpm

# 1. Clone + setup
git clone https://github.com/PeganaHQ/Pegana.git
cd Pegana
cp .env.example .env  # edit secrets

# 2. Start stateful deps
docker compose -f docker-compose.dev.yml up -d postgres redis

# 3. Run migrations (xtask's `migrate` only PRINTS this — it does not apply them)
sqlx migrate run --source migrations

# 4. Validate seeded mints against mainnet RPC
cargo run -p xtask -- verify-assets

# 5. Run all services
cargo run -p indexer-rs &
cargo run -p engine-rs &
cargo run -p api-rs &
cargo run -p dispatcher-rs &
```

## Production deploy

Split layout:
- **Backend** (api + indexer + engine + dispatcher + mcp + protocol-indexer + postgres + redis + prometheus + caddy): Hostinger KVM 2 (~$13.99/mo) via `docker compose up -d`. Caddy terminates TLS for `api.pegana.xyz` + `mcp.pegana.xyz`.
- **Frontend** (Next.js console + marketing, proprietary and not part of this repository): Vercel free tier on `pegana.xyz` / `www.pegana.xyz`, pointing at `NEXT_PUBLIC_API_BASE=https://api.pegana.xyz`.

The production deploy and rollback runbooks are maintained privately.

## Stack

| Layer | Tech |
|---|---|
| Ingestion + processing | Rust 1.90 · tokio · sqlx · reqwest |
| Systemic risk indexer | TypeScript · Bun · @kamino-finance/klend-sdk · @jup-ag/lend-read |
| Storage | Postgres 16 + TimescaleDB · Redis 7 |
| Alert delivery | REST, WebSocket and MCP on the hosted service. `dispatcher-rs` also ships Ed25519-signed webhook fan-out (`webhook_subscriptions`) for self-hosted deployments; the hosted service does not offer webhook registration. |
| Typed API clients | TypeScript (`@peganahq/sdk-ts` on npm) · Python (`pegana-sdk`) — OpenAPI-generated |
| Edge | Caddy 2 (auto-TLS) |
| Observability | Tracing JSON · Prometheus metrics and alert rules · Alertmanager notifications once a Discord webhook is configured · Sentry in the web app once a project DSN is configured |

## Testing

| Suite | Tests | Command |
|-------|-------|---------|
| Rust workspace | 613 | `cargo test --workspace --all-targets` |
| MCP | 14 files | `bun run test` |
| Protocol indexer | 7 files | `bun run test` |
| SDK TypeScript | 3 files | `bun run test` |
| SDK Python | 3 files | pytest |
| Golden backtest | byte-exact | `cargo xtask backtest --case 2025-10-10-usde-depeg --check` |

## Cost

`$0` local dev · `~$14/mo` lean production (Hostinger KVM 2; frontend on Vercel free tier)

External APIs used (all free): Sanctum extra-api, Jupiter lite-api, Pyth on-chain push feeds (read over Solana RPC), public Solana RPC, Kamino REST, Jupiter Lend REST.

## License

Pegana code is licensed by path: the oracle service is source-available under [FSL-1.1-MIT](LICENSE), while the methodology and verifier (`pegana-methodology`, `pegana-replay`) are Fair Source under FSL-1.1-MIT with the [Pegana Verification Permission](VERIFICATION-PERMISSION.md). In short: read, run, modify and verify freely, including commercially, with the Pegana Verification Permission; each release becomes MIT two years after it ships. The SDKs, documentation, and examples are open source under [MIT](LICENSE-MIT). The `web/` app is proprietary. Each service version changes to MIT two years after it is made available; versions published before this change remain MIT. See [LICENSING.md](LICENSING.md) for the path map and [TRADEMARK.md](TRADEMARK.md) for the Pegana marks.
