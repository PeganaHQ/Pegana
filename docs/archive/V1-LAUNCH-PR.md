# V1 launch — PR body (paste-ready)

> Copy the block below into the GitHub PR `landing/v2-port` → `main`.
> Companion runbooks: **`docs/runbooks/v2-launch.md`** (ordered deploy steps),
> **`docs/LAUNCH-CHECKLIST.md`** (A–F readiness + founder-only gates),
> **`docs/RELAUNCH-AUDIT-MASTER-2026-07-18.md`** (the 7-round hardening ledger).
>
> Snapshot when written: HEAD `613dba0b`, `origin/main` `3e2cc908`, **425 commits ahead**,
> methodology **0.7.0**, 72 assets (~67 active). Merges clean (zero conflicts).

---

## Title

`V1 launch: merge landing/v2-port → main (V2 relaunch + 7-round hardening + cleanup)`

## TL;DR

This PR is the official **V1 launch**. It brings `main` (and prod) from the pre-hardening
build up to the fully-hardened, adversarially-audited-**to-convergence** relaunch:
**425 commits, methodology 0.7.0, gate green byte-exact.** Merging = Vercel web prod;
the Rust services deploy via the ordered sequence below. A buyer on pegana.xyz today still
sees the **old** build — this PR is what makes the whole hardening real.

## What's in it

**Trust engine (methodology 0.7.0)** — ADR-0039 NAV↔BLACK_SWAN carve-out, ADR-0040 bot
idempotency, the unified `override_final_state_attributed` (engine / rederive / xtask agree
**by construction**, not empirically), Pyth confidence gate (ADR-0032, `PYTH_CONFIDENCE_GATE_BPS
= 500` compile-time const), intrinsic-liveness gate (ADR-0038, ships **DISABLED + byte-exact**),
source-side plausibility floors on every price leg.

**7-round adversarial hardening (this campaign)** — ~45 findings fixed incl. **4 P0s**:
per-chat idempotency launch-blocker (each alert was reaching only 1 of N subscribers),
Telegram fan-out isolated onto its own semaphore + made crash-safe, pyth_spot price floor
(false-CRITICAL on USDC/USDT), magic-link group-chat leak (account takeover), plus SSRF
(redirect-follow + IPv4-mapped / NAT64 / 6to4 IPv6), stale-mute resurrection, subs
case-sensitivity, audit-CSV truncation observability. **Every round's fix was itself
adversarially re-verified the next round** — full ledger in
`docs/RELAUNCH-AUDIT-MASTER-2026-07-18.md`.

**V5 site + product** — all `(marketing)` pages on the V5 design system, market-cap,
ORACLE_DEGRADED badge, `/whats-new`, embed widget, the on-chain-proven USDe backtest.

**V1 cleanup (this session)** — removed verified-dead scaffold assets, 2 dead API routes,
dead Rust/bot code, and the **`/pricing` + waitlist** feature (it advertised tiers/API-keys/
email-digests that don't exist — a credibility risk on a trust product). Removed the
misleading footer **"License (MIT)"** link (the product/webapp is not MIT — only the public
methodology + Replay CLI are).

## Ordered activation (founder-only — follow `docs/runbooks/v2-launch.md`)

1. 🔒 **Rotate the crates.io token**, then **publish crates methodology-FIRST** (`pegana-methodology`
   0.7.0) → **then the Replay CLI** (pins `=0.7.0`). Verify `cargo install` + a byte-exact check.
2. 🔒 **Merge this PR → `main`** = Vercel web prod (auto-build + auto-promote, ~1–2 min).
3. **`deploy.sh --migrate`** — migs 0064–0068. ⚠️ **0067's `oracle_snapshots` index: apply manually
   first** with `WITH (timescaledb.transaction_per_chunk)` (hypertables reject the plain `psql -f`).
4. **Calibrate the Pyth conf-gate vs prod — BEFORE the engine recreate** (ADR-0032 Query A/B).
   ⚠️ `PYTH_CONFIDENCE_GATE_BPS = 500` is a **compile-time const**, so it goes verdict-affecting
   LIVE unconditionally at step 5. This is a **hard gate**, not optional.
5. **Recreate the engine** (0.7.0 + gates). **Never mid-calibration.**
6. **`deploy.sh --services 'api indexer'`** — ⚠️ single-quoted, space-separated (comma = one bogus
   service that rebuilds neither).
7. **Ops** — update `ops/alerts/pegana.yml`, then `docker compose kill -s SIGHUP prometheus` from
   `~/pegana` (compose DNS doesn't resolve from the host shell).
8. **Later / separate step (NOT at merge):** enable `INTRINSIC_LIVENESS_GATE` only after a prod
   calibration cycle. Rollback = unset (instant, no rebuild).

## Founder-only gates to resolve at/before merge (see LAUNCH-CHECKLIST E/F)

- 🟠 **On-chain claim mismatch (reputational):** the public docs promise on-chain verification
  "by default", but prod has `PEGANA_COMMIT_KEYPAIR` **unset** → the exact verify command shown
  on the methodology page + CLI README returns **ONCHAIN_INCOMPLETE (exit 5), not PASS**. Either
  **(a)** fund the commit wallet (`7Ppoyum…u7R9`, ≥0.05 SOL) + set the keypair, or **(b)** reframe
  the public claim to the honest current state. **Don't launch with the mismatch live.**
- **Merge via a GitHub PR, not a local `git merge`** — `main` genuinely diverged.
- **GTM (blocked, founder-only):** send the drafted Ernani reply (cheapest, highest-leverage) ·
  grade / override the ADR-0007 scorecard (**2026-07-31**) · align every launch-copy asset count
  (72 total / ~67 active — pick total-active vs the *calibrated* subset; the calibrated number is
  the honest one for a trust pitch).

## Validation (green on this branch)

`cargo test --workspace` 43 suites · `cargo clippy` 0 · `cargo fmt --all --check` · **golden
backtest byte-exact (`no drift ✓`)** · web `tsc` 0 + **796 vitest** + eslint + prettier · bot
`tsc` + 74 tests + eslint. Branch **merges clean** vs `origin/main` (`3e2cc908`), zero conflicts.

## In scope — the whole product is V5

- The **`(app)` console is fully on the V5 design** — the W3a–c + W4 migration shipped
  2026-07-10/11 (V5 tokens/fonts at the root for both route groups; dashboard, /assets,
  /asset, /compare, /events, /account, /auth all on the same token/type/motion system as
  marketing). A signed-in visitor sees no pre-V5 surface. (Corrected 2026-07-19 — an earlier
  draft of this PR wrongly listed the console as pre-V5, from a stale DESIGN.md/brand.md spec.)

## Explicitly NOT in this PR (known, deliberate)

- **Demand.** 0 paying customers. This is a *capability launch with a genuinely strong product*,
  not yet a commercial launch — GTM is the next axis, not more code.

## Rollback

- **Engine:** redeploy the prior methodology tag (full engine redeploy — no faster path if the
  Pyth gate misfires).
- **Web:** Vercel instant rollback to the prior promotion.
- **Intrinsic-liveness gate:** unset `INTRINSIC_LIVENESS_GATE` (instant, no rebuild).
