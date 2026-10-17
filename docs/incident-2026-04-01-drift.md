# Incident — 2026-04-01 Drift protocol exploit (dSOL deactivation)

**Status:** resolved (asset soft-deactivated)
**Severity:** medium (data hygiene, not signal failure)
**Detected by Pegana:** N/A — exploit was external, not a peg event
**Recorded in Pegana:** 2026-05-26 (Wave 4 review)
**Author:** Rafael

## Summary

On 2026-04-01 the Drift protocol was exploited for $285M via compromised
admin keys (DPRK-linked). TVL collapsed from $550M to <$10M and the
protocol was permanently frozen. Source: solana-knowledge protocol
catalog, which now lists Drift as `DEFUNCT — DO NOT INTEGRATE`.

dSOL (Drift's liquid-staking token) lost its live counterparty: no
deposit, no redemption, no fee accrual. Sanctum's `/v1/sol-value/current`
endpoint still returns a (stale) `sol_per_lst` reading because the
account state is frozen on-chain, which would have produced a falsely
"PEGGED" signal on Pegana's dashboard.

## Why this is in Pegana's incident log even though it isn't a peg event

Pegana's value proposition is "the public peg-risk oracle for Solana".
A `dSOL` row reading `PEGGED · -2 bps · 30 s ago` on the dashboard while
the protocol behind it is frozen is a credibility failure. Any
Solana-native reviewer recognizes Drift's status immediately and will
discount the entire feed. This is the "stale-asset on a real-time
dashboard" problem.

## Actions taken (2026-05-26)

1. **`assets.toml`** — added `active = false` to the `dSOL` entry with a
   header comment explaining the cause. Entry preserved (not deleted) so
   historical snapshots remain queryable.

2. **`migrations/0020_deactivate_dsol_drift_exploit.sql`** —
   `UPDATE assets SET is_active = false WHERE symbol = 'dSOL';`
   Same pattern used for 0011 (unusable market source) and 0012 (BRZ).

3. **Frontend cleanup** — removed `dSOL` from:
   - `web/app/(marketing)/page.tsx` mocked landing array
   - `web/lib/alerts/policy.ts` per-asset thresholds
   - `web/lib/data/concepts.ts` LST list (`Twelve` → `Eleven`)
   - `web/app/(marketing)/developers/examples/examples-client.tsx` (replaced with `bbSOL`)
   - `web/components/organisms/recipe-mocks.tsx` (replaced with `bbSOL`)
   - `README.md` LST list

4. **README.md** — added a footnote pointing here.

## What is NOT changed

- Historical snapshot rows in `intrinsic_snapshots`, `market_snapshots`,
  and `discount_snapshots` for `dSOL` are preserved. The asset page
  `/asset/dSOL` can still render the pre-exploit timeline if useful for
  marketing ("Pegana watched Drift collapse in real time").

- The `dSOL` row in the `assets` table is preserved (FK target for
  historical snapshots). Only `is_active` flipped.

## Lesson learned

Pegana's asset universe needs a periodic protocol-health sweep, not just
mint verification. `cargo xtask verify-assets` confirms the mint exists
and the owner program matches, but a frozen protocol still has a valid
mint. Recommend: monthly pass that cross-references each tracked asset's
issuing protocol against the solana-knowledge catalog's DEFUNCT list and
DefiLlama TVL trend. Open this as a follow-up task before public launch.

## How to re-activate (almost certainly never)

If Drift ever resumes operations and dSOL becomes a live instrument
again: set `active = true` in `assets.toml`, write a new migration to
flip `is_active` back, and restore the entries removed from the frontend
files above.

## Update — 2026-07-15: reactivated

The "almost certainly never" call above did not hold up. During a routine
LST-coverage expansion, re-verification against `extra-api.sanctum.so/v1/lsts`
and `lst-directory.com/api/directory` found the dSOL mint still catalogued
under an active `SanctumSpl` stake-pool (vote account
`DriFTm3wM9ugxhCA1K3wVQMSdC4Dv4LNmyZMmZiuHRpp` — Drift's own validator), with
$217.4M TVL, 4,469 holders, all liveness flags clear (`stale`/`dead`/
`deprecated` all false), and — the decisive signal — an exchange rate that
is monotonically increasing epoch-over-epoch (1.203178 → 1.204609 over 5
epochs). A frozen or rugged stake pool cannot produce that rate curve;
staking yield is actively accruing, which means deposits/redemptions and
fee accrual are functioning normally today.

In hindsight, the risk model in this doc conflated two separate pieces of
infrastructure: Drift's DEX/perps/lending program (reportedly exploited via
compromised admin keys) and the dSOL stake pool (a native-SOL-stake
`SanctumSpl` pool delegated to Drift's own validator). These are different
programs with different authorities — an admin-key compromise on the
trading contracts does not automatically compromise a stake-pool account's
withdraw/stake authorities. That may be exactly why the stake pool kept
functioning while the trading protocol stayed frozen.

**Action taken:** `assets.toml` — added a new `dSOL` `[[assets]]` block with
`active = true` (thresholds reset to the current LST batch default,
55/140/300 bps, since the pre-freeze calibration is 3.5 months stale).
`migrations/0064_lst_coverage_expansion.sql` — `UPDATE assets SET
is_active = TRUE ... WHERE symbol = 'dSOL'`.

**Explicitly NOT done** (out of scope for an engine/DB config batch,
flagged for founder follow-up): the frontend removals listed above
(README LST list, marketing mocks, `web/lib/alerts/policy.ts` thresholds,
`web/lib/data/concepts.ts` LST count) were not restored. dSOL will be
monitored and will accrue snapshot history, but will not resurface on
public-facing frontend surfaces until that follow-up lands.

**Confidence:** high on the "stake pool is alive and accruing" claim (it's
directly observable in the rate history). Lower on "the underlying
protocol-level risk this incident was about is fully resolved" — this
reactivation is based on stake-pool health, not a re-audit of Drift's
trading contracts. Founder should treat this as "safe to monitor again,"
not necessarily "Drift the protocol is vindicated."
