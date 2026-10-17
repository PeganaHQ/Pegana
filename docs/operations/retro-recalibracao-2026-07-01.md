# Recalibration retro — 2026-07-01 (50 beta assets)

Scheduled remote routine `trig_01Dm5px8jhjWx3WfrgxpcDjM` (7-day window closing
~2026-07-01). Cohort = the **50 `monitoring_only` (beta) assets**: the ~13 original
(calibration-v1 downgrades + Phase-0 + frozen-leg + sHYUSD + xSOL) **plus the 37 net-new
from the 2026-06-24 asset expansion**. Data source: live public API (`/v1/assets`,
`/v1/calibration`, `/v1/audit`) — no prod DB read required.

## Headline finding

The retro's raw numbers (**31 `watch` + 1 `miscalibrated`** of 50) were dominated by a
**measurement bug**, not asset misbehaviour. `/v1/calibration` measured p95 over symmetric
`abs(discount_smooth)`, while the engine classifies `lst`/`stable_yield` **one-sided** (premium
→ PEGGED, ADR-0021). Verified live: **30 of the 31 `watch` are LSTs (+ INF) 100% on the benign
premium side** (discount-side max over 24h = `0.0 bps`, 0 transitions, PEGGED, high confidence).
→ Root fix = **ADR-0029** (direction-sensitive calibration metric), not asset re-tuning.

### Evidence (live, 2026-07-01)

| metric | value |
|---|---|
| assets total / beta / calibrated | 63 / 50 / 13 |
| beta health (symmetric, before ADR-0029) | 18 `ok`, 31 `watch`, 1 `miscalibrated` |
| of the 31 `watch` | 30 LSTs + INF are premium-side (benign); **1 = PST** (real discount) |
| beta transitions in the 7d window | only 4 assets: PST (14), ONyc (2), JLP (2), sHYUSD (1) |
| after ADR-0029 (direction-sensitive) | 30 LSTs + INF → `ok`; sHYUSD stays `miscalibrated`; PST stays `watch` |

Proof numbers (discount-side / premium-side max, 24h): INF 0.0 / 170; mSOL 0.0 / 87;
BNSOL 0.0 / 80; JSOL 0.0 / 53; **PST 37.6 / 0** (real); **sHYUSD 0.0 / 1185** (pathological
premium → `premium_sanity` → UNKNOWN).

## Decisions

- **A — Direction-sensitive calibration health. ✅ DEPLOYED + VERIFIED LIVE (2026-07-01, `b4e5d89`,
  `deploy.sh --services api`).** ADR-0029. Read-only API + ops SQL; no methodology bump, no
  migration. fmt/clippy/5 unit tests green; codex independent review clean. **Live proof:** beta
  health went `31 watch → 1 watch`; INF/mSOL/BNSOL/… → `ok` (p95=0); sHYUSD stays `miscalibrated`
  (p95=1490); PST stays `watch` (p95=37).
- **B — Graduate the clean set (metadata migration, mirrors 0048).** After A deploys and the
  corrected `/v1/calibration` is read back: promote the high-confidence, PEGGED, 0-transition,
  8-day, non-structural, `ok` assets (see table). Single `metadata - 'monitoring_only'` flip,
  `deploy.sh --migrate --config-only`, no rebuild. NOT yet done.
- **C — PST + thin-market cohort → ADR-0028 depth gate.** Observe-first (Phase 0: log
  `priceImpactPct @ ~$1000` per asset, verdict unchanged, hash-preserving). The 0.5.0 flip stays
  founder-gated + 7-day announce + replay diff + time-boxed (do not let it displace demand work).
  PST is contained today (beta/provisional stamps the flap). NOT yet done.
- **D — sample-count floor. ✅ DEPLOYED with A.** `<200 samples in 8d → no_data` on
  `/v1/calibration`, so a genuinely *sparse* (newly-added) asset can't show a confident `ok`.
  Live check: it flips nothing today (all assets have ≥200 samples). **Correction (honesty):** it
  does **not** catch USDu — USDu is not sparse, it is *stale* (dark now: `state=null`/
  `updated_at=null`, but has ≥200 rows from earlier, so `/v1/calibration` reads its 8d band-fit as
  `ok`). USDu's darkness is already surfaced honestly on `/v1/assets`; a freshness guard here was
  deliberately not added (it would duplicate that + false-flag FX weekend-dark). **Real fix:**
  root-cause USDu's ingestion — a data-integrity follow-up, not a calibration-health change.
- **E — Classify JLP's 06-24 `BLACK_SWAN`.** `PEGGED→BLACK_SWAN→DRIFT` in ~1.5h on activation day
  — likely cold-start transient. Read the receipt; if confirmed, promote next window.
- **F — Governance.** ADR-0029 + this retro + criterion-4 amendment (all in this branch).

## False-alarm self-check (does this fix create false comfort?)

The metric change carves out the LST premium. **Verified it is not hiding a real signal:**
cross-checked the premium against an independent oracle (Pyth market feed) for the 4 LSTs that
carry one — jitoSOL +88/+79, bSOL +83/+72, INF +162/+161, mSOL +88/+59 (Jup/Pyth bps). Two
independent market sources agree the premium is **real** (liquid-staking premium), so carving it
out is correct. The discount side (real depeg risk) still counts in full; a premium >1000 bps
still counts (sHYUSD).

**But the trap is in *promotion*, not the metric.** The audit (2026-06-28, C1/C2 CRITICAL) shows
`market_usd` for ~38 assets is a **1-unit Jupiter quote** on unverified-depth pools. The 4 LSTs
above have a Pyth cross-check; the **22 new expansion LSTs do not** — their `health=ok` rests
solely on that suspect market leg. **`health=ok` ≠ market-leg-verified. Promotion must add a
market-leg trust gate; it must NOT auto-follow `health`.** Promotion therefore follows the
audit's validated roster below, NOT the full `ok` set.

## Per-asset verdict (after ADR-0029, gated on the audit roster + market-leg trust)

| Bucket | Assets | Action |
|---|---|---|
| ✅ Promote (audit CALIBRATED_CANDIDATE — established, depth/Pyth-trusted) | mSOL, INF, bbSOL, hyloSOL, JupUSD¹, EURC, AUSD | metadata flip (Decision B), after A is live |
| ⚠️ Promote-with-caveat (audit-endorsed but `medium` conf / event) | USDG, USD1 (new Pyth feed, wide CI) · JLP (classify 06-24 BLACK_SWAN first, Decision E) | confirm CI / event before flip |
| ⏸ **HOLD — the 22 new expansion LSTs (no Pyth cross-check, unverified depth)** | BNSOL, dynoSOL, PSOL, hSOL, JSOL, edgeSOL, jagSOL, definSOL, sharkSOL, BulkSOL, cgntSOL, LST, CDCSOL, bpSOL, haSOL, laineSOL, xandSOL, raiSOL, picoSOL, mangoSOL, lanternSOL, iASOL, proSOL, RoXSOL, bonkSOL, dzSOL, vSOL | `health=ok` but **not** market-verified → stay beta until ADR-0028 depth data (audit: INVESTIGATE >$1M or skip) |
| ⏸ Hold — structural | hyloSOL+ (frozen, mig 0049), ONyc (frozen/thin, mig 0050), xSOL (Class C by design; audit "leverage NAV monitor") | keep containment |
| 🔧 Hold — broken / noisy (audit NEEDS_BETTER_SOURCE) | PST (thin DexScreener, 14 tr), sUSD, eUSX, USX, USD*, USDu (stale/dark now — `state=null` on `/v1/assets`; ingestion root-cause) | Decisions C / D |
| ⛔ Hard block | sHYUSD (`miscalibrated`, UNKNOWN — correct) | root-cause market/intrinsic leg (ADR-0028) |

¹ JupUSD extra bar (NAV-residual floor): 0 CRITICAL in the window → passes; confirm at migration.

**The correction vs. the naive read:** the naive "promote all ~36 `ok` assets" would have graduated
27 LSTs whose price is an unverified 1-unit Jupiter quote — the exact false-comfort the audit
(C1/C2) warns about. Promotion is scoped to the **audit's 7 trusted + 3 caveated**, and explicitly
holds the 22 new LSTs pending ADR-0028 depth verification.

## Governance notes

- ADR-0029 is read-only → **no methodology version bump, no `pegana-replay` diff, no receipt
  impact**. The 2026-06-25 stability lock has ended regardless.
- The `no_data`/thin guard (D) and the depth gate (C, 0.5.0) are deliberately **out of this
  increment** to keep it tight and certain.
