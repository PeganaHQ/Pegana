# Promotion criteria — beta (monitoring-only) → calibrated

> Created 2026-06-12 (T+1 post-launch). Governs the **7-day retro (~2026-06-18)**
> that decides which `monitoring_only` assets graduate to fully-calibrated.
> Grounded in [ADR-0015](../adr/0015-calibration-v1-per-class-verdict.md) (verdict
> rule) and [ADR-0002](../adr/0002-per-asset-activation-rule.md) (per-asset
> activation). This is the **inverse of the downgrade** in `CALIBRATION-v1.md`.

> **⚠️ AMENDED 2026-06-16 (BETA RELEASE).** The framing below was written under
> the 2026-06-12 *egress gate*, where `monitoring_only` = **suppressed from
> every public surface**. That gate was **reversed on 2026-06-16**: the 13
> `monitoring_only` assets are now **RELEASED as "beta"** — they alert publicly,
> stamped provisional (`calibration:provisional` on webhooks, 🧪 footer on the
> bot, `beta` badge on web, `monitoring_only`/`calibration` on the REST rows).
> So this retro is **no longer "promote silent → public"**; it is now **"drop
> the beta label"** — graduate a well-behaved provisional asset to `calibrated`
> (counts in the denominator, badge clears). The per-asset *gate* (the criteria
> in this doc) is **unchanged**; only what promotion *changes* is different
> (label drop, not un-suppression). sHYUSD remains a HARD BLOCK; the 4
> frozen-signal assets (sHYUSD/hyloSOL+/ONyc/xSOL) stay beta and emit UNKNOWN
> honestly via the 0.4.0 NAV-sanity guard.

## Why this exists

`monitoring_only` is a real behavioral flag. As of the 2026-06-16 beta release
it makes an asset **alert publicly but stamped provisional ("beta")** across
every surface — `/v1/alerts` + `/v1/audit` rows (now carrying
`monitoring_only: true` + `calibration: "provisional"`), Telegram (🧪 footer),
webhooks (`calibration: "provisional"`), and the web `beta` badge. (Before
2026-06-16 the same flag instead *suppressed* those surfaces — the egress gate,
`project_monitoring_egress_gate_2026_06_12`. The beta release flipped suppress →
label; see the ROADMAP "Current state — 2026-06-16".)

Consequence that makes this doc cheap to act on: **promotion is still a single
metadata flip.** Clearing `monitoring_only` drops the beta label for that asset
automatically — no code change, no redeploy. So the only hard part is the
*decision*, which is what this doc pins down.

## The cohorts (13 beta / monitoring-only assets)

| Cohort | Assets | Why monitoring-only | Promotable? |
|---|---|---|---|
| **1 — calibration-v1 downgrades** | mSOL, INF, bbSOL, hyloSOL | Failed ADR-0015 hybrid: p95 \|discount\| exceeded the `drift` band by <9 bps (24h-calibrated bands too tight) | Yes — at retro (the 9 well-signal candidates) |
| **1 — red flag** | sHYUSD | Engine confirms PEGGED on a −25% EWMA gap (unbounded premium carve-out × thin-Jupiter market leg); 0.4.0 NAV-sanity now maps it to UNKNOWN | **HARD BLOCK** |
| **2 — Phase-0 zero-history** | JupUSD, JLP, EURC, dzSOL, vSOL | Activated 2026-06-11 (ADR-0002) with **provisional thresholds, zero calibration window** | Yes — at retro |
| **F — frozen-signal/leg** | hyloSOL+ (mig 0049), ONyc (mig 0050) | A constant single-source discount — "illiquid at a stable peg", indistinguishable from a healthy-illiquid continuum (ADR-0024). The engine **cannot detect a real move**, so a calibrated promotion would be dishonest | **No** — until the liquidity/depth gate (Sub-B, needs Birdeye key) or a market-leg root-cause fix |
| **C — by design** | xSOL | synth_lev, sole survivor in class, wide thresholds by design (ADR-0015 Class C) | **No** — permanent monitoring-only |

## Promotion gate (per-asset, evaluated at the retro)

An asset graduates (clear `monitoring_only`) when it satisfies the **same
ADR-0015 hybrid criterion** over a **fresh ≥7-day post-launch window**
(2026-06-11 → retro date), tightened for the fact these assets were flagged
*specifically* for being uncalibrated/noisy:

1. **Data completeness** — ≥7 days with intrinsic **and** market snapshots fresh
   (`<6h` between updates per ADR-0015), **zero** `source_outage` labels.
   (Reuse Query D of `scripts/calibration-v1-queries.sql` with the window
   bounds bumped to `2026-06-11 00:00 UTC → <retro>`.)

2. **Calibration — EITHER:**
   - **(i)** ≥3 state transitions in the window, **all manually labelled
     TRUE** (proves the threshold is *reachable* and not noisy), **OR**
   - **(ii)** `p95 |discount_bps| < thresholds_bps.drift` for the asset, with
     continuous fresh data (proves the band is *well-calibrated* on a calm
     asset). Query A, post-launch window.

3. **Zero noise** — **0** transitions labelled `false_positive` / `noisy` in the
   window. (Stricter than the verdict's ≤20% — these assets were downgraded
   *for* noise, so promotion requires they've proven clean.)

4. **Band re-tune (only if (ii) fails by a tight margin).** ⚠️ **AMENDED by
   [ADR-0029](../adr/0029-calibration-health-direction-sensitive.md)
   (2026-07-01):** the `drift ≈ p99 × 1.25` heuristic is **only valid for
   symmetric classes**. For direction-sensitive classes (`lst`, `stable_yield`)
   it is **wrong** — their `p95/p99` is dominated by a *benign premium* (market
   above NAV, carved out to PEGGED per ADR-0021), and widening `drift` to fit it
   would **blind the discount side**, the one side that carries the depeg signal.
   Since ADR-0029 the calibration metric is direction-sensitive (premium carved
   out; premium beyond the 10% NAV-sanity bound counted as a broken anchor), so a
   well-behaved LST already satisfies (ii) **without any band change**. Re-tune a
   direction-sensitive band only against its **discount-side** dispersion, never
   to accommodate a premium. For symmetric classes the original `p99 × 1.25`
   heuristic still applies; document in `crates/methodology/CHANGELOG.md` + an ADR
   and **re-observe ≥7 days** (a band change is a methodology bump — the
   2026-06-25 stability lock has since ended; still batch per ADR-0009).

5. **sHYUSD — HARD BLOCK.** Do **not** promote until the market/intrinsic leg is
   root-caused + fixed (unbounded LST/yield premium carve-out is freezing PEGGED
   on garbage thin-Jupiter prints; see `assets.toml` lines ~279-285). Promotion
   of sHYUSD is gated on that fix landing + a clean ≥7-day window after it.

6. **JupUSD — extra bar.** It carries both the NAV-residual floor (`6b7bb53`) and
   the egress gate. Promote only after ≥7 days **post-fix** with **zero false
   CRITICAL** and p95 within `drift`.

## Mechanics of promotion

1. Per-asset decision documented (data behind it), per ADR-0015 / ADR-0002.
2. Remove the `# monitoring-only per ADR-0015 …` annotation in `assets.toml`.
3. New migration mirroring 0048's cleanup clause:
   ```sql
   UPDATE assets
   SET metadata = metadata - 'monitoring_only' - 'monitoring_since' - 'monitoring_reason'
   WHERE symbol IN (<promoted set>);
   ```
4. `deploy.sh --migrate --config-only` (no rebuild needed — the gate reads the
   metadata live; clearing the flag re-opens the surfaces). Engine/indexer need
   no recreate unless a band re-tune shipped in the same window.
5. Re-run the verdict denominator: promoted assets re-enter their Class A/B count.

## Override

Per ADR-0015, Rafael may override the mechanical outcome with a **written
reason** in the retro report. Default is the mechanical decision.

## Timeline

- **~2026-06-18** — 7-day retro: evaluate cohorts 1 & 2 against the gate above.
- **2026-06-25** — stability lock ends; band re-tunes (item 4) may ship.
- sHYUSD + any re-tuned asset: promote on the first clean ≥7-day window after
  the underlying fix.
