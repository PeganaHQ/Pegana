# Spec 05 — Trust-minimized intrinsics (direct SPL stake-pool reads)

**Wave 2 · indexer · migration 0059 · ADR-0028 · no methodology version bump.** Moves the
LST "independent intrinsic" leg from a third-party HTTP call (Sanctum) to a value WE compute
from the chain — the verifiability moat.

## Problem / context

LST intrinsic `sol_per_lst` is read from Sanctum's HTTP API (`sources/sanctum.rs`, ~40 LSTs
incl. all majors). Convenient, but the "independent intrinsic" leg is really an HTTP call
that can stale/err/go down — and Sanctum's batch endpoint silently swaps unknown symbols
(`xtask/src/main.rs:122-125`). A direct read of the SPL stake-pool account computes
`intrinsic = total_lamports / pool_token_supply` ourselves, removing Sanctum from the trust
path — best alignment with the verifiability pitch.

**A generic adapter already exists** (recent expansion): `sources/spl_stake_pool.rs`
(`IntrinsicStrategy::SplStakePool`, channel `SRC_SPL_STAKE_POOL`) — used today for 3
monitoring-only LSTs (STKESOL/rkuSOL/corvusSOL). It hand-decodes the `StakePool` account
(byte offsets: `account_type@0`, `pool_mint@162`, `total_lamports@258`,
`pool_token_supply@266`, `last_update_epoch@274`), owner-checks against canonical
`SPoo1Ku8…` + SanctumSpl fork `SP12tWFx…`, sanity-gates NAV ∈ `[0.99, 2.0)`, publishes the
**same envelope shape as Sanctum (incl. `value_sol`)** so the engine's SOL-cancellation path
works unchanged. RPC via the already-swapped Helius plumbing (`rpc::get_account_with_fallback`).

## ⚠️ Critical findings (reshape the design)

1. **mSOL (Marinade) is NOT an SPL stake-pool** — proprietary program/layout (confirmed `docs/spec.html:610`). `decode_nav_sol` cannot read it. **Leave mSOL on Sanctum** (or write a Marinade-specific decoder — out of scope; mSOL is monitoring_only anyway).
2. **INF (Sanctum Infinity)** is an S-controller multi-LST pool, not a plain `StakePool`. **Leave on Sanctum** pending a dedicated decoder.
3. **jitoSOL / bSOL / JupSOL / the SanctumSpl long-tail ARE standard SPL or SanctumSpl-fork pools** → the generic adapter works once `pool` + `program` are filled.
4. **Engine `set_intrinsic(sym, v)` is last-write-wins** (`state.rs:382-387`, no source dimension). So Sanctum + spl_stake_pool both writing the same symbol = a RACE, not a cross-check. "Keep Sanctum as cross-check" must be **out-of-band**, reading both sources from `intrinsic_snapshots` (which stores both as distinct `(asset, source, ts)` rows) and emitting a divergence metric — NOT a dual-write into the engine.

## Design (decided)

- **Migrate eligible majors** by flipping the `assets.toml` strategy `sanctum_lst → spl_stake_pool` (needs the StakePool **state-account address** + owner program per LST; capture from Sanctum `/v1/lsts` or Solana Compass). Drop them from Sanctum's poll. **Pilot: jitoSOL** (highest liquidity, verdict-grade, canonical pool), then fan out to the SanctumSpl long-tail. **Leave mSOL + INF on Sanctum.**
- **Cross-check (out-of-band):** a lightweight divergence task (new indexer task OR xtask) that, for migrated LSTs, compares the direct `spl_stake_pool+pyth` read against a still-running Sanctum read for the same mint and emits `pegana_lst_intrinsic_divergence_bps{symbol}`. The `[0.99,2.0)` NAV gate already fails-closed on layout drift.
- **verify-assets hardening:** `xtask` `verify_one` (`:160-200`) validates only the mint, not the `pool` address — add a pool-account check (owner==program, `account_type==1`, `pool_mint==mint`) so CI catches a wrong/typo'd pool address.

## Methodology impact — ADR + replay, NO version bump

Direct read vs Sanctum agree to **well under 1 bp** in steady state (same on-chain numbers);
real divergence only at the **epoch boundary** (Sanctum may reflect pending rewards/fees not
yet in `total_lamports`) — a transient few-bps step, and since discount is computed in SOL
terms (multiplier cancels) the effect is small. The **source string is NOT a canonical
receipt input** (`canonical.rs`) → flipping it leaves the receipt hash stable → **no
methodology version bump** (confirm via the `canonical.rs` proptest `:226+`). Still ADR +
replay-diff (same bar as ADR-0023) because numbers shift a few bps. ADR-0028.

## Files to touch (exact)

- `assets.toml` — per eligible major: `intrinsic = {kind="sanctum_lst", symbol="X"}` → `{kind="spl_stake_pool", pool="<state acct>", program="<owner>"}`. First targets: jitoSOL (`:27`), bSOL (`:61`), JupSOL (`:119`), + SanctumSpl long-tail. **Leave mSOL (`:42`) + INF (`:76`).**
- `crates/indexer-rs/src/sources/spl_stake_pool.rs` — no change for canonical/SanctumSpl pools (Marinade branch only if mSOL is ever in scope — out of scope here).
- `crates/indexer-rs/fixtures/spl_stake_pool/` — add `{jitosol,bsol,jupsol,…}-pool.json` (`getAccountInfo` captures) + decode tests mirroring `:277-308`.
- **NEW** `migrations/0059_lst_direct_reads.sql` — data-only `UPDATE assets SET intrinsic_kind='spl_stake_pool', intrinsic_cfg='{"pool":…,"program":…}'::jsonb WHERE symbol IN (…)` (DB mirrors TOML; pattern `0054`). No schema change.
- `crates/xtask/src/main.rs` — add the pool-account check in `verify_one` (`:160-200`).
- **NEW** cross-check task — `crates/indexer-rs/src/sources/intrinsic_crosscheck.rs` OR an xtask, emitting the divergence metric.

## Risks

- **Layout variants (highest):** Marinade proprietary (skip), INF S-controller (skip), SanctumSplMulti forks may differ — the owner check + `[0.99,2.0)` gate fail-closed, but a wrong address that decodes in-range would publish garbage → hence the verify-assets pool check.
- **Silent NAV freeze:** a pool whose `total_lamports` advances only at epoch boundaries can look frozen intra-epoch (the hyloSOL+ class). Direct reads make `last_update_epoch` visible (good); watch the freeze interaction.
- **Don't drop the free cross-check:** preserve Sanctum as the out-of-band integrity monitor.
- **RPC load:** ~40 majors × 1 `getAccountInfo`/30s on Helius free tier is trivial. `accountSubscribe` push is a SEPARATE follow-up — don't bundle.
- **Calibration:** indexer-only recreate (engine untouched).

## Test plan + acceptance

- Unit: per-LST fixture + `decode_nav_sol` (NAV ∈ (1.0,1.2), tl/pts>0) mirroring `:277-308`; a negative test asserting a Marinade account is rejected (wrong `account_type`/size).
- Divergence: for each migrated major, `|nav_sol(on-chain) − sol_per_lst(Sanctum)| < ~5 bps` intra-epoch; documented larger transient at epoch turnover.
- Replay: `cargo xtask backtest` over an epoch-boundary window → bounded/zero state change vs Sanctum baseline; receipts byte-stable (version unchanged).
- verify-assets: `cargo xtask verify-assets` green with the new pool check; Sanctum-coverage check still green for the remaining `sanctum_lst` set.
- Acceptance: fmt/clippy/test green; indexer recreate; `pegana_spl_stake_pool_nav_sol{symbol}` populated for migrated majors; divergence metric within bound; ADR-0028 + replay-diff recorded.

## Decided open questions

- mSOL & INF stay on Sanctum (no proprietary-decoder investment now) — DECIDED.
- Cross-check = out-of-band task reading `intrinsic_snapshots` — DECIDED.
- No methodology version bump (confirm via `canonical.rs` proptest) — DECIDED.
- Pilot = jitoSOL, then SanctumSpl long-tail — DECIDED.
- Calibration standing of migrated (monitoring_only) majors: flag for review whether re-promotion is needed (the source flip doesn't change the FSM, but document) — OPEN, low-stakes.

## Grill outcomes

- *"Is a few-bps shift worth an ADR + replay?"* — Yes; ADR-0023 set the bar that any source-methodology change shifting discount gets ADR + replay. The trust-minimization payoff (removing a third-party server from the verifiability claim) is the point, and the cross-check turns the old dependency into a free integrity signal.
- *"Why not migrate everything including mSOL?"* — mSOL/INF aren't SPL stake-pools; forcing the generic decoder on them would publish garbage. Honest coverage > broad coverage.
