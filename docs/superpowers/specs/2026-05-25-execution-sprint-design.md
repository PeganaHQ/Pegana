# Execution Sprint — 2026-05-25

> Status: approved · Source audit: this session's full-project scan · Out of scope: Hetzner deploy, Sentry/Grafana DSN, dogfood

This is an execution spec, not an architecture design. The architecture for every item already exists (ROADMAP.md Epics, sprint plan memory, audit screenshots). This doc fixes scope and order for a single working session.

## Goal

Land 7 trilhas of "code only" work as commit-atomic units, in fixed order, until natural stopping point (user signal, irrecoverable blocker, or session fatigue). Each trilha leaves the repo green and committable; partial work goes to a WIP commit.

## Out of scope

- Epic 10 (Hetzner deploy, DNS, Caddy, R2 backup) — separate session.
- Epic 11 (14-day dogfood + calibration) — passive, starts after deploy.
- Real Sentry DSN / Grafana Cloud / UptimeRobot wiring — depends on deploy.
- GSAP SplitText Club ($99/yr) — decided NOT to buy; use hand-rolled `splitWords()`.

## Sequence

### T1 — Push + housekeeping (~15min)
- `git push origin main` (8 local commits ahead).
- Move all 231 root `*.png` / `*.jpeg` files into `docs/design-research/archive-2026-05/` (audit history, not docs); add `*.{png,jpg,jpeg}` to root `.gitignore`.
- Delete `web/bun.lock` (web uses pnpm; bun.lock was experimental leftover).
- Delete branches contained in main: `feat/frontend-v1`, `worktree-phase-a-yield-bearing` (verify with `git branch --merged main` first).
- **Done:** `git status` clean, root has no loose screenshots, `git branch` shows only active branches.

### T2 — Fix hover preview pane (~30min)
- File: `web/components/organisms/AssetTable.tsx` and `AssetPreviewPane.tsx`.
- Bug: `onRowHover` prop is declared but the asset payload never propagates to the preview pane — pane always renders the default-widest asset.
- Fix: wire row hover handler → setState in parent (Dashboard page or dedicated context) → pane reads selected asset.
- Add Playwright spec: hover row N → pane title matches asset N.
- **Done:** manual browser check at `http://localhost:3000/dashboard`; spec passes.

### T3 — Métricas dos 3 sources (~30min)
- Files: `crates/indexer-rs/src/sources/dexscreener.rs`, `solayer_susd.rs`, `piggybank_pb.rs`.
- Mirror the `pegana_pyth_polls_total` / `pegana_sanctum_polls_total` pattern (already present).
- Counters: `pegana_dexscreener_polls_total{outcome="ok|err|skip"}`, `pegana_solayer_polls_total{outcome=...}`, `pegana_piggybank_polls_total{outcome=...}`.
- **Done:** `curl localhost:9091/metrics | grep -E 'dexscreener|solayer|piggybank'` returns 3 series with non-zero values after 1min running.

### T4 — Pyth confidence + Hermes jitter (~1-2h)
- **Confidence propagation:** today `oracle_snapshots.confidence` is SQL-hardcoded `'high'`. Engine receives `conf` from Pyth Hermes but discards it. Plumb the value: `crates/sources/src/pyth.rs` → `crates/engine-rs/src/oracle.rs` → SQL upsert.
  - Bucket: `conf/price < 0.001` → high; `< 0.01` → medium; else → low. Bucket constants in `crates/common/src/oracle.rs`.
- **Hermes reconnect jitter:** indexer Hermes SSE loop in `crates/indexer-rs/src/sources/pyth.rs`. Currently fixed-delay reconnect. Replace with exponential backoff (1s → 2s → 4s → ... cap 30s) + ±25% jitter.
- **Verification:** `docker network disconnect pegana_default pegana-prodlocal-indexer-1 && sleep 5 && docker network connect pegana_default pegana-prodlocal-indexer-1` → logs show jittered reconnect attempts.
- **Done:** `SELECT DISTINCT confidence FROM oracle_snapshots ORDER BY ts DESC LIMIT 100` returns at least 2 distinct values; reconnect logs visible.

### T5 — Bot session Memory → Postgres (~1h)
- File: `bot-ts/src/index.ts`.
- Replace `MemorySessionStorage` with `@grammyjs/storage-postgres` (or hand-rolled if simpler given existing pg pool).
- If schema lacks a session table, add migration `0014_bot_sessions.sql`: `CREATE TABLE bot_sessions (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`.
- **Done:** `docker restart pegana-prodlocal-bot-1`; previously-set `/lang en` survives; `SELECT count(*) FROM bot_sessions` > 0.

### T6 — Integration tests backend (~2-3h)
- Create `crates/integration-tests/` as a new workspace crate (or `tests/e2e_*.rs` files in existing crates if simpler).
- Fixture: testcontainers-rs OR connect to existing prod-local stack with isolated DB schema (e.g., `pegana_test`).
- Test 1: publish synthetic `IntrinsicReading` + `MarketReading` for `bSOL`, force `discount = -0.5%`, assert engine writes `discount_snapshots` row with `state='DRIFT'` after hysteresis window.
- Test 2: simulate `PEGGED→DRIFT→PEGGED` cycle, assert dispatcher emits exactly one alert per transition and respects 1h dedup.
- Wire into CI via `cargo test -p integration-tests --features=docker` (gated so it doesn't break non-Docker contributors).
- **Done:** `cargo test -p integration-tests` green locally; CI workflow updated.

### T7 — Design uplift P2/P3 (until tired)
Per-page commits, smallest first:
1. **Compare** — empty state shows preset preview ("Major LSTs", "USD-pegged stables", "Hylo stack") with faint sparklines instead of blank.
2. **Status** — replace flat list with stacked bar per source (uptime %) + 24h uptime sparklines.
3. **Embed** — badge specimen strip (4-5 size variants in a row).
4. **Developers** — syntax highlighting for code blocks (Prism or Shiki).
5. **Changelog** — tag filters (feat/fix/perf/docs) as toggle pills.
6. **About** — "Working on right now" widget pulling from `ROADMAP.md` first incomplete item.
7. **Learn** — 4-up grid layout for article cards (currently single column).
8. **Events** — heatmap calendar (most complex; might span sessions).

Per page: read mock screenshot from `docs/design-research/audit-2026-05-24-shipped/`, implement, screenshot, compare, commit.

## Commits

One per trilha (or per page in T7). Conventional prefix:
- `chore(housekeeping):` T1
- `fix(dashboard):` T2
- `feat(metrics):` T3
- `feat(oracle):` T4
- `refactor(bot):` T5
- `test(integration):` T6
- `feat(design):` T7 (one per page)

## Stop criteria

- User says stop.
- Irrecoverable technical blocker (need product decision, missing credential, broken upstream).
- Test failure I cannot debug in <30min — commit WIP, document blocker, move on or stop.

## Verification gate

After each trilha:
1. Did the smoke check pass? (curl, browser, SQL query as listed above.)
2. Are there new tests covering the change? If not, why? (Some items like housekeeping don't need tests.)
3. Lint / typecheck / clippy clean on touched code? (`cargo clippy -p <crate>`, `pnpm typecheck` in web.)

If 1 fails, the trilha is not done. If 2 has no good reason, write the test. If 3 fails, fix before commit.

## Post-session

After T1-T7 (or stop), invoke `review-and-iterate` skill to do a final pass for quality/security/production-readiness on everything touched. Iterate on its findings until green.
