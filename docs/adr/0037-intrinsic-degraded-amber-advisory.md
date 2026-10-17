# ADR-0037 — INTRINSIC_DEGRADED: an advisory "amber" backing-liveness layer (frontend-only, out-of-hash)

- **Status:** Accepted (2026-07-17). Built on `landing/v2-port`, 1:1-reviewed + adversarially reasoned, **NOT deployed**. Ships with the next Vercel web deploy — **no methodology bump, no CLI re-release, no migration, no engine/indexer redeploy, no API change** (see §Rollout). The lightest possible full-stack advisory: it lives entirely in `web/`.
- **Relationship to ADR-0035:** the backing-side twin of ORACLE_DEGRADED. ADR-0035 flags a shaky **oracle** leg (market↔oracle divergence, wide conf, stale publish); ADR-0037 flags a shaky **intrinsic** leg (a frozen/dead/deprecated backing). Both are **advisory, out-of-hash, never a verdict/receipt input**, both render as the amber `st-drift` badge on `/asset` below the verdict.
- **Decision owner:** founder (chose frontend-only + directory-flags-only for v1; whether to ever add native-epoch / software rate-freeze / promote to a verdict input — §Open).

## Context

Pegana's intrinsic side has **no liveness gate**. The engine's staleness check (`engine-rs/src/state.rs` `side_is_stale`, `SOURCE_STALENESS_SECS = 600`) is **timestamp-only**: it measures "time since we last *received* a value," not "time since the backing *advanced* on-chain." And the Sanctum source re-stamps `ts = Utc::now()` on every 15s poll (`indexer-rs/src/sources/sanctum.rs`), so a **frozen-but-still-served** backing gets a fresh wall-clock timestamp forever and reads as a confident PEGGED. This is exactly the **2026-04-01 dSOL failure mode** — the incident this whole backend-upgrade batch traces back to.

The "obvious" fix — wire the already-decoded-then-discarded on-chain epoch fields (`spl_stake_pool.rs` `last_update_epoch`, `hylo.rs` `update_epoch`) — has a **fatal coverage hole discovered during research:** those epochs exist for only **2 assets** (jitoSOL via the direct SPL read, hyUSD via Hylo). Sanctum's `/v1/sol-value/current` returns **only lamports strings — no epoch at all** — so the ~41 `sanctum_lst` assets that ARE the dSOL blast radius have no native liveness signal on that path.

**But lst-directory.com** (`GET /api/directory`, maintained by Hylo, already fetched server-side by `/lst`) serves per-row `flags: { stale, isNew, deprecated, dead }` for exactly that ~41-LST universe — verified live 2026-07-17 (the web already parses `flags.{deprecated,dead}` in `web/lib/lst/types.ts`). `flags.stale` is literally the directory maintainer's own "this LST's rate stopped updating" determination — the signal we want, already computed by an independent, curated source. (The live dSOL row reads `rate: 1.20497, deprecated: false, dead: false` — independently re-confirming dSOL's pool is ALIVE; the defer is about the missing *gate*, not dSOL health.)

## Decision

Surface an **advisory** amber `INTRINSIC_DEGRADED` badge on **single-asset detail** (`/asset/[symbol]`), driven by the directory's own liveness flags, kept **entirely frontend-only** — no Rust/engine/migration, mirroring how `/lst` already consumes the directory.

```
reason (worst-first: dead > deprecated > stale):
  backing_dead        flags.dead        the pool is dead
  backing_deprecated  flags.deprecated  the LST is being wound down
  backing_stale       flags.stale       the directory marks the rate non-advancing (the dSOL mode)
returns null when none fire → badge renders nothing (healthy / directory-uncovered LST)
```

- **Signal = directory flags only** (founder's v1 call). Deliberately NOT a software freeze-inference (`rate == ratePrev` over a window): that would edge toward the **ADR-0024-rejected** discount-constancy detection. The directory flags are the maintainer's OWN explicit determination — an independent, curated signal, no continuum inference. (`ratePrev`/`apyHistory[].epoch` are now available for a future rate-freeze corroboration — §Open.)
- **Architecture (frontend-only):** the asset-detail page is a `"use client"` component and the directory fetch is server-only (no third-party CORS guarantee). Bridge via a same-origin **route handler** `web/app/api/lst-liveness/route.ts` (mirrors the existing `token-logo` proxy) that server-side resolves `fetchLstDirectory()` (cached 15min) → returns just the per-mint flags; a client SWR hook `useLstLiveness(mint, class)` (LST-only, no-op for other classes) feeds the pure `classifyIntrinsicDegraded()` → `IntrinsicDegradedBadge` (amber `st-drift`, distinct `intrinsic_liveness` glossary term).
- **Silence is the correct neutral** — a healthy or uncovered LST has no flag. Unlike ORACLE_DEGRADED there is **no `updatedAt` freshness gate**: the flag is the maintainer's slow-moving (per-epoch, ~2-day) liveness call fetched fresh from the proxy, not a reading off the live price snapshot — tying it to the price timestamp would be the wrong freshness axis. An unreachable directory resolves to `null` upstream → renders nothing.

## Why frontend-only (vs mirroring ORACLE_DEGRADED's backend classifier)

ORACLE_DEGRADED needed the backend because its inputs (`oracle_snapshots` × `discount_snapshots`) live only in the DB. INTRINSIC_DEGRADED's input (the directory flags) is a public third-party payload the web **already fetches** — so a backend classifier would mean a new table + indexer write + migration + API change + an indexer redeploy, all to re-derive data the front already has access to. Given a large already-built-but-undeployed V2 surface, the founder chose the zero-backend-deploy-risk path: it ships with the Vercel web deploy and touches nothing stateful. The trade-off (re-fetches the directory payload via the proxy; diverges from the ADR-0035 pattern) is acceptable for an advisory. The backend-classified path stays the natural home if/when the signal is promoted to a verdict input (§Open) — that work needs it server-side anyway.

## Validation

- **16 web unit tests:** classifier worst-first + null-on-healthy/null (`intrinsic-degraded.test.ts`, 6); badge renders each reason + uses `st-drift` never the depeg/critical rose + nothing-when-absent (`intrinsic-degraded-badge.test.tsx`, 6); route handler 404s (missing mint / unreachable / uncovered) + returns flags+rate on match (`lst-liveness/route.test.ts`, 5, one overlaps). Plus the directory parser gains a `stale` assertion.
- **791 web tests green** + tsc + eslint clean.
- **Regression caught 1:1 (not by me — by the drift guard):** Item 1's dSOL defer (`c07fd47`) set dSOL `active=false` in `assets.toml` but left its mint in the web's hardcoded `jupiter-quote/allowlist.ts` `TRACKED_INPUT_MINTS` → the `assets.toml`↔allowlist symmetric-diff test failed. Removed dSOL's mint from the allowlist (lockstep note added). This is the [[feedback_always_1to1_validate]] discipline paying off.
- **Live-DOM limitation (honest):** the hero→hook→route→badge browser seam can't be exercised without `next dev`/`build` (forbidden — crashed the host before). The badge DOM render (jsdom testing-library), the route logic (mocked directory), and the classifier are unit-covered; the 3-line wiring is tsc-checked. That is the validation ceiling under the no-heavy-local-process constraint; noted rather than claimed as full live-DOM.

## Rollout (frontend-only → the lightest of the batch)

- **Zero backend.** No methodology bump, no CLI, no migration, no engine/indexer/api redeploy. Ships with the V2 web on the next Vercel deploy of `landing/v2-port`.
- Rollback: delete the route + badge + hook + classifier and revert the `DirectoryFlags.stale` add — nothing stateful.

## Open decisions (founder)

1. **Add native on-chain epoch-lag** for jitoSOL (SplStakePool) + hyUSD (Hylo) as a stronger corroborating signal (`current_epoch − last_update_epoch > N`) — the 2 assets where the chain gives us a first-class "last updated" field. Needs persisting the epoch (jitoSOL already has it in `intrinsic_snapshots.meta`) + fetching the current epoch. v2.
2. **Add software rate-freeze detection** (`rate == ratePrev` across a multi-epoch window) — source-agnostic, doesn't depend on the directory's judgment. Needs rate-history persistence + a careful ADR delineating input-constancy (backing) vs the ADR-0024-rejected output-constancy (discount). v2.
3. **Ever promote to a verdict input?** Forcing UNKNOWN on a `dead`/`stale` backing during an alerting tick would be **in-hash** → methodology bump + ADR + byte-exact backtest re-baseline (the depth-gate/ADR-0034 disabled-default pattern). This is the real close of the intrinsic-liveness gap; the advisory is the honest interim. Recommend advisory for launch.

## Cross-refs

- `web/app/api/lst-liveness/route.ts`, `web/lib/asset/intrinsic-degraded.ts` (`classifyIntrinsicDegraded`), `web/lib/hooks/use-lst-liveness.ts`, `web/components/atoms/intrinsic-degraded-badge.tsx`, `web/lib/lst/{types,parse}.ts` (`DirectoryFlags.stale`), `web/lib/glossary.ts` (`intrinsic_liveness`), mounted in `web/components/organisms/asset-hero-v2.tsx`.
- ADR-0035 (ORACLE_DEGRADED — the oracle-side twin + badge/glossary pattern) · ADR-0024 (freeze-detection rejected — why v1 uses curated flags not constancy inference) · ROADMAP "BACKEND UPGRADE batch — 2026-07-17" (Item 1 dSOL defer + Item 4 verifier + this).
