# Trilha D — Reliability (RPC / on-chain) Implementation Plan

> **For agentic workers:** Implemented by **Codex** (deep Rust), reviewed 1:1 by **Opus**. Steps use checkbox (`- [ ]`) syntax. This plan is written at task-altitude (exact file:line pointers + acceptance criteria + tests); the implementer reads the full enclosing functions.

**Goal:** Keep the oracle alive and honest under the market stress it exists to monitor — survive a Pyth Hermes key cutover (hard deadline ~31/07), a primary-RPC outage during a depeg, a silently-frozen upstream feed, and reduce on-chain request volume — all without changing the methodology or the receipt hash.

**Architecture:** All changes are in `crates/indexer-rs` (Pyth stream auth, batched on-chain reads, slot capture) and `crates/engine-rs` (observation-ts freshness, commit-RPC fallback). No methodology/threshold/discount change → **no receipt-hash change** (verify with the same baseline gate every task). Build on the existing `rpc::get_account_with_fallback` (primary→fallback already shipped) and the `new_with_commitment` pattern hylo already uses.

**Tech Stack:** Rust (Tokio, `solana-client` nonblocking RpcClient, `reqwest` SSE stream, `rust_decimal`, `sqlx`), Prometheus metrics.

**Parent spec:** `docs/superpowers/specs/2026-06-29-audit-remediation-campaign-design.md` (§3 Sprint D).

**Per-task gate (padrão forte):** after each task — `cargo build` + `cargo clippy --workspace --all-targets` (0 warnings) + `cargo fmt --all --check` + `cargo test` for the touched crate(s) + the **hash-invariance baseline** (Task 0). Codex implements with TDD; Opus reviews spec + quality 1:1 and re-verifies independently.

---

## Verified integration points (from code, 2026-06-30 — do not re-discover blindly, but confirm)

- **rpc.rs** already exports `get_account_with_fallback(primary, fallback, pubkey, label)` (single account, primary→fallback, metric `pegana_rpc_primary_failed_total`). M14/H5 ADD a sibling for many-accounts + slot.
- **hylo.rs** builds both `rpc` and `rpc_fallback` via `RpcClient::new_with_commitment(..., confirmed())` (`:126,:130`), and `poll_once` (`:168`) calls `get_account_with_fallback` ≥3× (`:382` mint supplies, `:402` pool ATA, `:443` hylo_state). These are the calls to batch.
- **config.rs**: `pyth_hermes_url` (default `https://hermes.pyth.network`, `:18-19,:70-71`). No `pyth_*_api_key` field exists (only `jupiter_api_key`, `tokens_xyz_api_key`).
- **pyth.rs**: stream URL built at `:164`; request sent via `state.http_stream` client at `:178-182`; reconnect backoff at `:149` (`*2 .min(30_000)`); `scale_price` clamps `expo` at 28 (search `.min(28`).
- **engine state.rs**: `set_intrinsic`/`set_market`/`set_intrinsic_sol`/`set_market_sol` (`:444,:451,:478,:488`) stamp `last_*_at = Some(Utc::now())` (receive-time); `side_is_stale` consumes `last_*_at` (`:510-511`). The Pyth *price* path already uses `entry.publish_time` (`:383`) — the model to follow.
- **engine main.rs**: `build_commit_context` (`:1555`) builds `rpc = Arc::new(RpcClient::new(rpc_url))` (`:1586`, no commitment, no fallback) → `CommitContext { rpc, ... }` (`:1605`). `CommitContext.rpc: Arc<RpcClient>` (`onchain_commit.rs:50`) — single endpoint.

---

## File Structure

| File | Change | Tasks |
|---|---|---|
| `crates/indexer-rs/src/config.rs` | `pyth_hermes_api_key: Option<String>` (+ optional keyed default URL) | 1 (H3) |
| `crates/indexer-rs/src/sources/pyth.rs` | bearer auth on stream request (H3); `scale_price` bail >28 (L5) | 1, 5 |
| `crates/indexer-rs/src/rpc.rs` | `get_multiple_accounts_with_fallback` → (accounts, slot) | 2 (M14/H5) |
| `crates/indexer-rs/src/sources/hylo.rs` | batch poll_once reads → 1 RPC + capture slot | 2 (M14/H5) |
| (intrinsic insert path) | thread `slot` into the snapshot write | 2 (H5) |
| `crates/engine-rs/src/state.rs` | `set_*` take observation `ts` instead of `Utc::now()` | 3 (M3) |
| `crates/engine-rs/src/main.rs` | pass Redis-envelope `ts` into `set_*`; build commit `rpc_fallback` | 3, 4 |
| `crates/engine-rs/src/onchain_commit.rs` | `CommitContext.rpc_fallback`; alternate on retry | 4 (H4) |

---

## Task 0: Hash-invariance baseline (safety net)

- [ ] **Step 1: Capture baseline** — `cargo run -q -p pegana-replay-cli --bin pegana-replay -- --bundle docs/backtests/2025-10-10-usde-depeg/receipts/USDe-004.json`
  Expected: `PASS USDe Critical -> Depeg ... (re-derived)` + `recomputed receipt:31c06db4fc9a matches stored receipt:31c06db4fc9a`.
- [ ] **Step 2:** Re-run after EVERY task below; the `31c06db4fc9a` hash MUST stay byte-identical (Trilha D touches ingestion/transport, never the methodology). Any change = stop and fix.

---

## Task 1: H3 — Pyth Hermes API-key readiness (⏰ hard deadline ~31/07/2026)

**Files:** `crates/indexer-rs/src/config.rs`, `crates/indexer-rs/src/sources/pyth.rs`

Hermes will require an API key; keyless `hermes.pyth.network` will start 401-ing and the SSE stream (and thus all confidence/RR/spot logic) freezes. Make the engine key-ready NOW so the founder only has to set an env var later.

- [ ] **Step 1 (TDD):** add a unit test in config.rs that `IndexerConfig` deserializes `pyth_hermes_api_key` from env/serde and defaults to `None`. Add a test that a small helper `fn pyth_auth_header(key: Option<&str>) -> Option<(&'static str, String)>` returns `Some(("authorization", "Bearer <key>"))` when set and `None` when absent. Run → fails (symbol missing).
- [ ] **Step 2:** add `#[serde(default)] pub pyth_hermes_api_key: Option<String>` to the config struct (mirror `jupiter_api_key`). If the operator wants the keyed dourolabs endpoint, they set `pyth_hermes_url` via env (already supported) — do NOT hardcode a second URL; just allow the key. Document in a comment that the keyed Hermes host goes in `PYTH_HERMES_URL` and the key in `PYTH_HERMES_API_KEY`.
- [ ] **Step 3:** in `pyth.rs` where the stream request is built (`~:178-182`), attach the bearer header when the key is present (e.g. `.bearer_auth(key)` or `.header("authorization", ...)`). No behavior change when the key is `None` (keyless still works until the cutover). Keep the existing `http_stream` (no-whole-request-timeout) client.
- [ ] **Step 4:** verify — `cargo test -p indexer-rs`, `cargo build`, clippy, fmt, hash gate unchanged.
- [ ] **Step 5:** commit `feat(indexer): Pyth Hermes API-key readiness (bearer auth, key-gated) — H3` + Co-Authored-By trailer.

> **Acceptance:** with no key set, the stream connects exactly as today (keyless). With `PYTH_HERMES_API_KEY` set, the request carries `Authorization: Bearer …`. Founder action (provision the key + set `PYTH_HERMES_URL` to the keyed host) is then a config-only deploy.

---

## Task 2: M14 + H5 — batch hylo on-chain reads + capture slot

**Files:** `crates/indexer-rs/src/rpc.rs`, `crates/indexer-rs/src/sources/hylo.rs`, the intrinsic-snapshot insert path.

hylo's `poll_once` does ≥3 sequential `get_account_with_fallback` calls per tick. Collapse to ONE `getMultipleAccounts` (lower request volume → Helius headroom) and capture `context.slot` to populate the currently-always-`None` `slot` column and enable slot-stale detection.

- [ ] **Step 1 (TDD):** in `rpc.rs`, add `get_multiple_accounts_with_fallback(primary, fallback, pubkeys: &[Pubkey], label) -> Result<(Vec<Option<Account>>, u64)>` returning the accounts in request order PLUS the response `context.slot`. Use `get_multiple_accounts_with_commitment(pubkeys, CommitmentConfig::confirmed())` and read `.context.slot` + `.value`. On primary error, fall back (same shape as the single-account helper; increment `pegana_rpc_primary_failed_total`). Add a `module_compiles`-style smoke test (live RPC not unit-testable, like the existing helper) AND, if feasible, a small pure test of the ordering/zip logic by factoring any index-mapping into a testable helper.
- [ ] **Step 2:** confirm in `poll_once` that all account pubkeys are known up-front (mints, pool ATA, hylo_state are derivable before any read — they are: constants/PDAs). If any address depends on a prior read, keep that one separate and batch the rest; note it. Rewrite `poll_once` to issue ONE `get_multiple_accounts_with_fallback` for the independent set, then decode from the returned `Vec<Option<Account>>` (preserve the existing decode + `bail!`/context error handling for a missing/None account).
- [ ] **Step 3 (H5 slot):** thread the returned `slot` into the intrinsic-snapshot write. Find the insert path (grep `insert_intrinsic` / the SQL that writes `intrinsic_snapshots`); the `slot` column already exists (BIGINT nullable) and is currently passed `None`. Pass `Some(slot as i64)`. If hylo writes via a shared helper used by other sources, keep their `None` (only hylo gains the slot) — do not change other sources' signatures destructively; an `Option<i64>` param already exists.
- [ ] **Step 4 (optional, same task):** if cheap, emit a debug/metric when the returned slot is older than the previous tick's slot (slot regression = stale RPC). Only if it doesn't balloon scope; otherwise leave a `// TODO(H5): slot-stale gate` and note it.
- [ ] **Step 5:** verify — `cargo test -p indexer-rs`, build, clippy, fmt, hash gate unchanged. Manually sanity-check the decode still produces the same intrinsic values (the math is unchanged; only the fetch is batched).
- [ ] **Step 6:** commit `perf(indexer): batch hylo on-chain reads via getMultipleAccounts + capture slot — M14/H5` + trailer.

> **Acceptance:** hylo issues 1 RPC round-trip per tick instead of ≥3; `intrinsic_snapshots.slot` is populated for hylo rows; intrinsic values are unchanged (decode logic untouched).

---

## Task 3: M3 — freshness uses observation ts, not receive-time

**Files:** `crates/engine-rs/src/state.rs`, `crates/engine-rs/src/main.rs`

`set_intrinsic`/`set_market`/`_sol` stamp `last_*_at = Utc::now()` (when the engine *received* the Redis message), so a source that keeps republishing a frozen value looks fresh forever — `side_is_stale` never trips; only the 900s H12b sweep notices. Use the observation `ts` carried in the Redis envelope (the same field the Pyth price path already respects via `publish_time`).

- [ ] **Step 1 (TDD):** add a unit test on the `EngineState` that after `set_intrinsic(sym, v, ts_old)` with `ts_old = now - 20min`, `side_is_stale(window, last_intrinsic_at, now)` returns `true` for a window < 20min (today it would be `false` because it stamps now()). Mirror for `set_market`. Run → fails.
- [ ] **Step 2:** change `set_intrinsic`/`set_market`/`set_intrinsic_sol`/`set_market_sol` to take an explicit `observed_at: DateTime<Utc>` and store THAT in `last_*_at` (instead of `Utc::now()`).
- [ ] **Step 3:** at the call sites in `main.rs` (where the engine consumes Redis discount/intrinsic/market envelopes), pass the envelope's observation timestamp. Confirm the envelope carries it (the sources publish `ts`/`publish_time`; e.g. `pyth.rs:301`, `hylo.rs` publish). If a particular envelope lacks a ts, fall back to `Utc::now()` AT THE CALL SITE (not inside set_*) and add a `// fallback: envelope had no ts` comment — do not silently mask.
- [ ] **Step 4 (guard against false-stale):** verify the per-feed staleness WINDOWS already accommodate slow-cadence NAV feeds (the `intrinsic_window_secs` / per-asset windows). Do NOT tighten any window in this task. If a slow daily-NAV feed would now false-stale because its observation ts is legitimately old-but-valid, that means the window is the right lever — leave windows as-is and note any asset that looks at risk (the existing windows were sized for this; M3 only changes the *timestamp source*, not the thresholds).
- [ ] **Step 5:** verify — `cargo test -p engine-rs`, build, clippy, fmt, **hash gate unchanged** (freshness gating is not a receipt input — confirm), and run the engine unit/integration tests that cover staleness.
- [ ] **Step 6:** commit `fix(engine): freshness uses observation ts not receive-time (subsumes L3/L8) — M3` + trailer.

> **Acceptance:** a frozen-but-republishing source trips `side_is_stale` within its window (seconds-to-minutes), not only after the 900s sweep. Slow NAV feeds do not false-stale (windows unchanged). No receipt-hash change.

---

## Task 4: H4 — primary/fallback commit RPC (engine)

**Files:** `crates/engine-rs/src/onchain_commit.rs`, `crates/engine-rs/src/main.rs`

The engine's on-chain commit uses a single `RpcClient` (`main.rs:1586`, no commitment, no fallback). During a depeg burst, the same market stress strains RPCs — a primary outage means receipts queue to the 24h dead-letter instead of landing live. Add a fallback endpoint, alternate on retry. (Timeout + retry + dead-letter already exist — do NOT re-add them.)

- [ ] **Step 1 (TDD):** add a unit test that `CommitContext` exposes a `rpc_fallback` and that the retry-selection helper picks the fallback on an even/odd attempt (factor the "which client for attempt N" choice into a tiny pure fn `fn rpc_for_attempt(attempt: u32, primary, fallback) -> &RpcClient` and test it). Run → fails.
- [ ] **Step 2:** add `pub rpc_fallback: Arc<RpcClient>` to `CommitContext` (`onchain_commit.rs:50`). In `build_commit_context` (`main.rs:1555-1606`), build it from a fallback URL env (`PEGANA_COMMIT_RPC_FALLBACK` or reuse the indexer's fallback env if shared — check `SOLANA_RPC_URL`/fallback convention) and set `CommitmentConfig::confirmed()` on BOTH primary and fallback (the primary currently has none — fix that here, which closes L8-engine). If no fallback env is set, default `rpc_fallback = rpc.clone()` (degrade gracefully to single-endpoint, no behavior change).
- [ ] **Step 3:** in the commit attempt path (`attempt_commit` ~`:241-347`), use `rpc_for_attempt` so the first attempt uses primary and a retry after an RPC error uses the fallback (the retry loop already exists; just swap the client it uses on the RPC-error branch). Keep `get_latest_blockhash`/`send_transaction` semantics; only the client instance alternates.
- [ ] **Step 4:** also pass `rpc_fallback` (or keep primary) to `check_wallet_balance`/`run_wallet_balance_monitor` only if trivial; otherwise leave them on primary and note it (out of scope to thread everywhere).
- [ ] **Step 5:** verify — `cargo test -p engine-rs`, build, clippy, fmt, hash gate unchanged. Confirm the existing commit tests (dead-letter, terminal-failure, retry) still pass.
- [ ] **Step 6:** commit `feat(engine): primary/fallback commit RPC, alternate on retry (closes L8 commitment) — H4` + trailer.

> **Acceptance:** with a fallback env set, a primary-RPC failure on a commit retry uses the fallback endpoint; with no fallback env, behavior is identical to today (rpc_fallback = rpc clone). Both clients pin `confirmed()` commitment.

---

## Task 5: L5 — `scale_price` fails loud instead of silent clamp

**Files:** `crates/indexer-rs/src/sources/pyth.rs` (the `scale_price` fn, `.min(28)` site)

A Pyth `expo` more negative than -28 is silently clamped to scale 28, producing a wrong (inflated) price. Real feeds use -8/-9 so this never fires today, but a silent-wrong-number path is the opposite of the trust thesis. Convert to a skip-loud.

- [ ] **Step 1 (TDD):** add a unit test: `scale_price` with `expo.abs() > 28` returns an `Err`/`None` (skip), not a clamped wrong value; `expo` in the normal range is unchanged. Run → fails (currently clamps).
- [ ] **Step 2:** replace `10u64.pow(abs.min(28))` with a guard that `bail!`/returns `None` when `abs > 28` (match the fn's existing error type). The caller already skips a bad tick — route to that path.
- [ ] **Step 3:** verify — `cargo test -p indexer-rs`, build, clippy, fmt, hash gate unchanged.
- [ ] **Step 4:** commit `fix(indexer): scale_price skips out-of-range expo instead of silent clamp — L5` + trailer.

> **Acceptance:** an out-of-range expo skips the tick (no publish) rather than emitting a silently-wrong price. Normal feeds unaffected.

---

## Sprint exit criteria

- [ ] All 5 tasks committed on `trilha-d-reliability`.
- [ ] `cargo build` + `cargo clippy --workspace --all-targets` (0 warnings) + `cargo fmt --all --check` clean.
- [ ] `cargo test --workspace` green; web unaffected (no web changes).
- [ ] **Hash baseline `31c06db4fc9a` byte-identical** after the final task (Trilha D must not touch the receipt).
- [ ] Opus 1:1 review of each task + `/code-review` high on the full sprint diff; every finding fixed.
- [ ] Deploy: `scripts/deploy.sh --migrate` only after explicit founder OK (no new migration expected — H5 reuses the existing `slot` column; confirm no migration needed). Founder env to provision later: `PYTH_HERMES_API_KEY` + keyed `PYTH_HERMES_URL` (H3), `PEGANA_COMMIT_RPC_FALLBACK` (H4).

## Self-review (author)

- **Spec coverage:** H3(T1) · M14/H5(T2) · M3(T3, subsumes L3/L8-staleness) · H4(T4, closes L8-commit-commitment) · L5(T5). All Sprint D items present.
- **Placeholder scan:** the intrinsic-insert path and the exact fallback-env name are resolved at execution (grep `insert_intrinsic` / check `SOLANA_RPC_URL` convention) — flagged as confirm-steps, not vague TODOs.
- **Hash safety:** every task re-runs the baseline; none touches methodology/discount/thresholds/receipt — expected zero hash change.
- **Codex-altitude:** tasks give exact file:line entry points + acceptance + test shape; Codex reads the full functions. Opus re-verifies independently (the Trilha A pattern: don't trust "tests pass" — check the diff + behavior).
