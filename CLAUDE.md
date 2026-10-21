# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Pegana is

A **peg-risk oracle for Solana**: it tracks the divergence between an asset's **intrinsic value** (what it *should* be worth given its peg mechanism) and its **market value** (what a swap actually returns) for the 67 LSTs and stablecoins on the public peg surface on mainnet. When the gap crosses per-asset thresholds it publishes a state transition over REST, WebSocket and MCP (webhook fan-out exists in `dispatcher-rs` for self-hosting only), and emits a reproducible audit receipt.

The single most important mental model: **`intrinsic − market = discount → EWMA smoothing → threshold classification with hysteresis → state machine → transition → alert + receipt`**. Everything in the Rust workspace exists to feed, compute, or fan out that pipeline.

## Repo layout

Polyglot monorepo. Rust does ingestion + computation + serving; TypeScript does MCP, a secondary indexer, and the web console.

**Rust workspace** (`crates/`, members in `Cargo.toml`):
- `methodology` — **pure, deterministic, zero-I/O** functions (discount, EWMA, thresholds, transitions, receipt hashing, rederive). This is the trust anchor: the engine calls it at runtime and `pegana-replay-cli` calls the *same* functions offline to reproduce any receipt byte-for-byte. Never add tokio, I/O, or global state here.
- `common` / `common-verify` — shared types (`AssetConfig`, `AssetsFile`, `IntrinsicStrategy`, `TokenProgram`), observability, webhook signing/channels. `methodology` depends on `common-verify` (**not** `common`) on purpose, so it mirrors cleanly into the public `pegana-replay` repo — never make `methodology` depend on `common` directly.
- `indexer-rs` — ingestion; 13 tokio tasks fan out over `src/sources/` (sanctum, jupiter, pyth, hylo, dexscreener, spl_stake_pool, perena, token_supply, tokens_xyz, tokens_xyz_risk, …) and write via `src/sinks/` (postgres, redis_pub).
- `engine-rs` — discount engine + state machine (`state.rs`) + on-chain commit + evidence reconcile. Consumes indexer output, produces receipts.
- `dispatcher-rs` — alert fan-out (webhook delivery, dedup, retraction, evidence reconcile).
- `api-rs` — axum REST + WebSocket. Routes in `src/routes/` (`assets`, `peg`, `audit`, `calibration`, `methodology`, `stats`, `health`). Also rate-limiting, risk scoring, OpenAPI.
- `pegana-replay-cli` — the **only** published binary (crates.io as `pegana-replay` 0.5.2); offline receipt verification with `--json` + colored output, exit codes 0–5.
- `xtask` — repo task runner (aliased as `cargo xtask`).

**Typed SDKs** (`sdk/`, published — NOT private):
- `sdk/typescript` — `@peganahq/sdk-ts` **0.3.1 on npm**; OpenAPI-generated full coverage of all 21 `/v1` endpoints + hand-written `PegFeed` / `connectPegFeed` WebSocket helper.
- `sdk/python` — `pegana-sdk` **0.3.0**; OpenAPI-generated (21 `/v1` endpoints (24 incl. health/readiness)) + hand-written `peg_feed` async iterator.

**TypeScript services** (each is Bun + its own `package.json`):
- `mcp-ts` — MCP server; every tool is free (no payments, no API keys). Tests use vitest.
- `protocol-indexer-ts` — "Sub-C Loop Intelligence": polls Kamino + Jupiter Lend for **anonymous, aggregate** leverage/health-factor data (never persists position owners; k-anonymity k≥5, ADR-0036). **DEPLOYED to prod** (31 assets, $837M collateral, 2 protocols). A grep-guard (`test/adr-0036-guard.test.ts`) bans `.owner`/`.authority`/`*ByWallet*` in `src/sources/*.ts` — never read per-wallet data here. The guard IS wired into CI (`.github/workflows/ci.yml`, job `protocol-indexer-ts` — added 2026-07-31 along with the package's first `eslint.config.mjs`, since its `lint` script had never once run). GitHub Actions billing was restored (workflows running again as of 2026-10-16), so the guard is machine-enforced once more — but when in doubt, still run `bun test` in `protocol-indexer-ts/` by hand before touching `src/sources/`. Writes to the shared TimescaleDB.
- `web/` — Next.js 16 console + marketing (Vercel). **Has its own `web/CLAUDE.md` → `web/AGENTS.md`; read it before touching web code.**

Data plane: **Postgres 16 + TimescaleDB** and **Redis 7** (pub/sub between services). All services are wired together in `docker-compose.yml`.

## Build, test, lint

### Rust workspace (from repo root)
Toolchain is pinned to **1.90** via `rust-toolchain.toml`. The codebase uses runtime `sqlx::query()` (not compile-time `query!` macros) almost everywhere, so **`cargo check`/`build`/`clippy` do NOT need a database**.

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings   # CI treats warnings as errors
cargo check --workspace --all-targets
cargo test --workspace --all-targets
cargo test -p engine-rs <test_name>                     # single crate / single test
```

Integration tests **self-skip** unless their env vars are set (see `docker-compose.local.yml`): `PEGANA_INTEGRATION_DB` / `PEGANA_INTEGRATION_PG_URL` / `PEGANA_INTEGRATION_REDIS` gate the DB/Redis tests (dispatcher-rs, engine-rs, some api-rs), while most api-rs HTTP tests instead gate on `PEGANA_INTEGRATION_API_BASE` (URL of a running api-rs).

`cargo xtask` subcommands (defined in `crates/xtask/src/main.rs`):
```bash
cargo xtask verify-assets --file assets.toml --strict   # validate every mint vs mainnet RPC (CI-gated)
cargo xtask migrate                                     # ⚠️ NO-OP: only PRINTS `sqlx migrate run` — does NOT apply
cargo xtask backtest --case 2025-10-10-usde-depeg --check  # replay methodology against golden fixture
cargo xtask prune-webhook-deliveries --days 30
```
Apply migrations with `sqlx migrate run --source migrations` (prod: `deploy.sh --migrate`; CI: a psql loop). `cargo xtask migrate` is only a reminder stub.

### TypeScript services (`mcp-ts`, `protocol-indexer-ts`)
Same script names in each; run from that package's directory:
```bash
bun run typecheck        # tsc --noEmit
bun run lint             # eslint
bun run test             # vitest
```
mcp-ts extras: `bun run test:integration`, `bun run test:devnet`, and a single test via `vitest run -t <name>`.

### Web (`web/`)
```bash
bun run typecheck
bun run lint
bun run test             # vitest
bun run test:e2e         # playwright
```
**Do not run `next dev` or `next build` locally** — these are heavy and have crashed the dev machine. Verify web changes with `typecheck` + `vitest` + Playwright against a static/preview server, not a local Next dev server.

## Local development

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d postgres redis   # stateful deps only
sqlx migrate run --source migrations                             # `cargo xtask migrate` only PRINTS this — it does not run it
cargo xtask verify-assets                                        # sanity-check seeded mints
cargo run -p indexer-rs & cargo run -p engine-rs & cargo run -p api-rs & cargo run -p dispatcher-rs &
```

`docker-compose.local.yml` runs a full prod-like stack, deliberately on offset host ports (Postgres **:5434**, Redis **:6381**, api **:8081**) so it can coexist with the dev compose and bare `cargo run`.

## Deploy & hard constraints

- **Backend** deploys to the Hostinger box (${PEGANA_DEPLOY_SERVER}, user `deploy`) via `scripts/deploy.sh` (`--config-only`, `--migrate`, `--services '<subset>'`, `--logs`). Read its header comment for modes; it encodes the launch runbook's gotchas.
- **Web** auto-deploys on push to `main` (Vercel). Therefore: **never `git push origin main`** — that ships to production. Push preview branches only.
- Commit by explicit path, never `git add -A`.
- `scripts/pre-deploy-check.sh` runs the pre-launch gauntlet against the local checkout.

## Architecture facts that span multiple files

- **`assets.toml`** is the canonical asset registry (68 active / 72 canon). Each entry declares its peg mechanism / `IntrinsicStrategy`, which drives per-asset intrinsic calc (fiat → $1; LSTs → Sanctum SOL-value or SPL stake-pool NAV; yield-bearing → issuer-attested NAV; hyUSD → on-chain collateral ratio). Deactivated assets stay with `active = false` for historical snapshots. Every change re-hashes the snapshot that goes into receipts (`cargo xtask verify-assets` gates it in CI). Note: `assets.toml` does **not** encode calibration status — whether an asset is `calibrated` vs `monitoring_only`/`beta` is DB-migration-driven (set by migrations 0048+), so don't infer the beta split by grepping the file.
- **Receipts / Trust Layer**: state transitions emit a public receipt at `/v1/audit/{id}` with methodology version + frozen inputs, optionally committed on-chain via SPL Memo. Reproducibility is guaranteed *because* `methodology` is pure and shared with `pegana-replay-cli`.
- **State-reason overrides** are string constants in `crates/methodology/src/lib.rs` (`premium_sanity`, `discount_sanity`, `pyth_confidence_gate`, `stale_source`, `intrinsic_liveness`) and are the source of truth. Only some have a duplicate that must stay byte-identical: `stale_source` (a SQL literal in `api-rs/src/routes/assets.rs`) and `pyth_confidence_gate` (a Rust const in `api-rs/src/oracle_degraded.rs`); `discount_sanity` and `intrinsic_liveness` never appear in api-rs — their DB-side contract lives in `migrations/0062` and `migrations/0068`. Changing a constant means updating every duplicate.
- **/v1 response envelope (ADR-0043)** is a cross-cutting convention: list endpoints return `{ok, generated_at, count, data}` via `ApiList<T>` (`crates/api-rs/src/response.rs`); single-resource endpoints are served **bare** (unwrapped — `ApiOne<T>` is defined as a ready-but-unused extension point); `/v1/peg/feed`'s `data` is an array with `mint` on each signal. New /v1 routes must follow this shape — the old dual-shape fallbacks were removed (prod == code).
- **SQL migrations** live in `migrations/` as sequentially numbered files (currently through `0078_*`); apply with `sqlx migrate run --source migrations` (the `cargo xtask migrate` subcommand only prints this, it does not run it). Never edit an already-applied migration — add a new one.
- **⚠️ Production is NOT sqlx-managed.** Verified against the box 2026-08-10: prod has **no `_sqlx_migrations` table**. `deploy.sh --migrate` detects this and takes its *legacy* branch, which applies only migrations numbered **≥ 71** and records each one in `pegana_migration_ledger` with its **SHA-256**. Two consequences that bite: a local `sqlx migrate run` and a prod deploy are different code paths, so "it applied locally" proves less than it looks; and because the ledger stores a checksum, **editing an already-applied migration makes every subsequent deploy abort** with "Checksum mismatch for recorded migration". Correct a shipped migration downstream (a new migration, or the docs), never in place.
- **Hylo NAV**: upstream hylo crates conflict with our solana-client 2.0 borsh tree, so PDAs are derived locally in `crates/indexer-rs/src/sources/hylo.rs` (see the note in `Cargo.toml`).

## Language

**Everything written into this repository is in English.** Code, comments, commit messages,
documentation, ADRs, test names, and user-facing copy. No exceptions, including notes written
during a session that started in another language.

This is a rule about the artifact, not about conversation: the repo is read by the public
`pegana-replay` mirror, by the docs site, by contributors, and by agents that are given only the
files. A doc that switches language mid-file is unreadable to half of them. Historical research
notes under `docs/design-research/` and `docs/call-prep-*` predate this rule and are left as an
archive; the living documents (`CLAUDE.md`, `web/AGENTS.md`, `DESIGN.md`, `CONTEXT.md`,
`README.md`, `ROADMAP.md`) are English throughout.

## Where the design decisions live

Domain terms are defined in **`CONTEXT.md`** (glossary) and decisions in **`docs/adr/`** (45 ADRs, `0001`–`0045`). When a term or rule is ambiguous, the ADR wins — check there before inventing behavior. `ROADMAP.md` tracks status. Web/marketing design is governed by `DESIGN.md` (supersedes `brand.md` for product surfaces).

**Mobile strategy is settled by ADR-0045**: Pegana ships as one installable web app with a single
Apple-derived interaction language on both platforms. There is no native iOS or Android client and
none is planned. The service worker **never caches `/v1/*`** — a cached peg state is
indistinguishable from a live one, which is the exact failure the product exists to prevent.

**Web-specific standing rules** (full text in `web/AGENTS.md`): Next.js 16 has breaking changes vs training data — read `node_modules/next/dist/docs/` before writing Next code; and every surface that renders rows of data must be a **real semantic `<table>`** (via `ListRowsV2` or hand-rolled `<table table-fixed>` + `<colgroup>`), never a stack of `<div>`s.
