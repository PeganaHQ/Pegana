# ADR-0031 — jitoSOL pilot: direct SPL stake-pool read (trust-minimization)

- **Status:** Accepted (2026-07-01). Implemented on `fix/docs-csp-mintlify-logo` worktree branch.
- **Spec:** `docs/superpowers/specs/2026-06-24-05-trust-minimized-stake-pool-reads.md`
- **Migration:** `migrations/0063_lst_direct_reads_jitosol.sql`

## Context

jitoSOL's intrinsic `sol_per_lst` was sourced from Sanctum's HTTP batch API
(`sanctum+pyth` source). While convenient, this places a third-party HTTP
endpoint in the verifiability trust path: the "independent intrinsic" leg for
the highest-liquidity verdict-grade LST was actually a Sanctum API call.

A generic adapter for direct SPL stake-pool account reads already existed
(`sources/spl_stake_pool.rs`, used for STKESOL/rkuSOL/corvusSOL), computing
`nav_sol = total_lamports / pool_token_supply` entirely from on-chain data with
no Sanctum dependency. jitoSOL's stake pool is a standard SPL pool, making it
an ideal pilot.

## Decision

1. **Flip jitoSOL** from `sanctum_lst` to `spl_stake_pool` in `assets.toml`
   (and mirror in `migrations/0063_lst_direct_reads_jitosol.sql`), using the
   verified pool state account address.

2. **Cross-check via a deploy-time overlap validation (pilot); ongoing
   divergence metric deferred to the fan-out.** The spec's original design kept
   Sanctum running as an out-of-band integrity monitor emitting
   `pegana_lst_intrinsic_divergence_bps{symbol}` from an `intrinsic_snapshots`
   diff. On implementation review this proved unworkable for a *single-asset*
   pilot: `sources/sanctum.rs` derives its poll set from assets whose
   `intrinsic.kind = sanctum_lst`, so flipping jitoSOL drops it from Sanctum
   entirely — a snapshot-diff cross-check goes silent within ~5 min and a silent
   gauge reads as "no divergence" (false confidence, which this project
   explicitly rejects). A genuinely-*ongoing* cross-check needs a dedicated
   Sanctum reader decoupled from the poll set — shared infrastructure that only
   pays off across *many* migrated LSTs. So for the pilot we validate the cutover
   with a **one-shot overlap check at deploy**: confirm the first
   `spl_stake_pool+pyth` NAV matches Sanctum's live jitoSOL `sol_value` within a
   few bps before promoting. The ongoing divergence metric (`M12`) is deferred to
   the fan-out (Spec 05 Wave 2), where it covers the full migrated set and the
   shared Sanctum-reader infra is justified. Ongoing baseline safety comes from
   the `[0.99, 2.0)` NAV gate, the owner/`account_type` check, and
   `xtask verify-assets`. Because `engine.set_intrinsic` is last-write-wins with
   no source dimension, this also avoids a dual-write race — the engine receives
   only the `spl_stake_pool+pyth` reading.

3. **No methodology version bump.** The source label stored in
   `intrinsic_snapshots` is not a canonical receipt input (`canonical.rs` hashes
   `methodology_version`, `assets_toml_canonical`, `InputsFrozen`, and
   `Computed`). The `InputsFrozen.intrinsic_usd` value comes from the same
   on-chain numbers, differing only in the computation path. The numerical
   difference is well under 1 bp in steady state.

4. **verify-assets hardening.** `xtask verify_one` now fetches the pool state
   account for `spl_stake_pool` intrinsics and validates: `owner == program`,
   `account_type == 1` (initialized StakePool), and `pool_mint == asset.mint`.
   This catches a wrong or typo'd pool address before it reaches the live indexer.

## Verified pool address

| Field | Value |
|---|---|
| Pool state account | `Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb` |
| Owner program | `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy` (canonical SPL stake-pool) |
| pool_mint | `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn` (jitoSOL mint — matches assets.toml) |
| Verified at slot | 430195986 (2026-07-01) |
| account_type | 1 (initialized StakePool) ✓ |
| NAV at verification | ≈1.2879 SOL/LST ∈ [0.99, 2.0) ✓ |

Source: `getAccountInfo("Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb")` on
`https://api.mainnet-beta.solana.com`, decoded per the layout documented in
`sources/spl_stake_pool.rs`. Captured in
`fixtures/spl_stake_pool/jitosol-pool.json`.

## Scope

**PILOT = jitoSOL only.** mSOL (Marinade proprietary program) and INF (Sanctum
Infinity S-controller) are NOT SPL stake-pools and MUST remain on Sanctum. bSOL,
JupSOL, and the SanctumSpl long-tail are deferred to a follow-up (fan-out).

## Risk mitigations

- `[0.99, 2.0)` NAV gate in `decode_nav_sol` rejects layout drift fail-closed.
- Pool account owner-check in `poll_one` rejects a wrong program at runtime.
- `verify-assets` pool-account check catches a wrong address in CI before deploy.
- Deploy-time overlap check: the first `spl_stake_pool+pyth` NAV is compared to
  Sanctum's live jitoSOL `sol_value` at cutover and must agree within a few bps
  before promoting (ongoing divergence metric deferred to fan-out — see Decision #2).
- `last_update_epoch` is logged in meta; the engine's freeze-detector (H12b) can
  catch an epoch-boundary stale if wired (separate follow-up).

## Cross-refs

- `crates/indexer-rs/src/sources/spl_stake_pool.rs` (existing decoder; +jitoSOL decode test)
- `crates/indexer-rs/src/sources/sanctum.rs` (still runs for all remaining `sanctum_lst` LSTs; jitoSOL dropped from its poll set)
- `migrations/0063_lst_direct_reads_jitosol.sql`
- `crates/xtask/src/main.rs` `verify_spl_pool_account` (new CI check)
- Spec 05 (`docs/superpowers/specs/2026-06-24-05-trust-minimized-stake-pool-reads.md`)
- ADR-0023 (hyUSD CR deadband — analogous source-level change without methodology bump)
