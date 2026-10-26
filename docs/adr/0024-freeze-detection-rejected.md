# ADR-0024 — Engine freeze-detection: attempted, reverted, and rejected

- **Status:** Rejected (the approach), 2026-06-14
- **Context:** P0 from the 2026-06-14 validation handoff — hyloSOL+ published a
  confident PEGGED off a frozen basis (1 distinct discount / 2400 samples over
  6h) while it was a public asset.
- **Supersedes the same-day attempt** (`ee7301a`, reverted by `7aadf34`).

## What we tried

An engine freeze detector: track the run of consecutive byte-identical raw
discounts per asset; once the run reaches a threshold, publish UNKNOWN instead
of a confident PEGGED (honest-dark, like the staleness gate). Shipped with
`FREEZE_THRESHOLD = 20` samples (~3 min).

## What went wrong

It **false-positived in production**. Within minutes of deploy, 7 assets flipped
to UNKNOWN — not just hyloSOL+ but five monitoring-only LSTs **and the public
JupSOL** — firing a false `PEGGED→UNKNOWN→PEGGED` alert chain on JupSOL for ~9
min before it was caught and reverted. The pre-deploy validation had measured the
wrong metric (total distinct values over 6h, not the max consecutive-identical
run the code keys on), so it missed that healthy illiquid LSTs sit identical for
minutes between trades.

## Why no threshold works (the decisive finding)

After the revert we measured the **max consecutive-identical discount run per
asset over 24h** — the exact metric a threshold detector keys on:

| asset | max run | | asset | max run |
|---|---|---|---|---|
| ONyc (public RWA) | **~20 h** | | bbSOL | ~1.5 h |
| hyloSOL+ | ~12.5 h | | mSOL / bSOL / JupSOL / INF | ~52 min |
| vSOL | ~6.5 h | | jitoSOL | ~43 min |
| dzSOL | ~3 h | | **USDC** | **~67 min** |
| hyloSOL | ~1.75 h | | stables (PYUSD/USDe/…) | ~3 min |

A constant discount is a **continuum**, not a frozen-vs-healthy gap:

- The **highest** max-run is **ONyc — a healthy, public RWA** that is *expected*
  to sit near-constant (it tracks a T-bill NAV; low volatility is correct).
- hyloSOL+ (the target) sits *below* ONyc and only modestly above several
  legitimately-illiquid LSTs (vSOL 6.5h, dzSOL 3h).
- Even **USDC** had a 67-minute constant stretch.

So **any** threshold that catches hyloSOL+ also flags ONyc (healthy RWA) and a
swath of healthy illiquid LSTs; any threshold that spares them misses hyloSOL+.
A constant discount does **not** mean "broken" — it usually means "illiquid asset
at a stable peg," which is normal and correct.

## Decision

**Do not build a discount-constancy freeze detector** (no threshold, adaptive or
fixed, can separate the classes — confirmed empirically). The correct handling of
an asset that lacks real price discovery is **curation, not detection**:

1. **Containment** — keep such an asset `monitoring_only` until it has genuine,
   multi-source price discovery. hyloSOL+ is contained this way (migration 0049,
   P0#1). This closes the public-exposure risk without any classifier change.
2. **Liquidity / depth gate (systemic, deferred to TIER 2)** — the right
   *signal* is market depth, not output-constancy: a sub-threshold pool / no
   recent fills means the market leg is unreliable → cap confidence and/or gate
   the verdict. This needs a depth source (Birdeye), which is key-gated and
   blocked until the 06-25 stability lock lifts. See
   `docs/data-source-upgrades-2026-06-09.md`.

## ONyc — RESOLVED: contained 2026-06-14

ONyc was public with a frozen market leg (d_mkt = 1 over 6h; ~20h constant) — the
same "can't detect a real market move" property hyloSOL+ had. Founder decision:
**contain it** (migration `0050`, `monitoring_only = true`). Conservative — it only
gates ONyc from public egress until it has a reliable market/depth source; the NAV
intrinsic is still tracked. Both public frozen-leg assets (hyloSOL+, ONyc) are now
contained; 13 assets monitoring-only total.

## Lesson

Validate on the **exact metric the code uses**, against the **full asset
population**, before deploying any classifier change — and prefer the lowest-risk
mitigation (containment) over a clever automated detector when the signal classes
overlap.
