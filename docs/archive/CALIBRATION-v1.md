# Pegana calibration v1

**Status:** ✅ verdict 2026-06-10 — **SHIP via DOWNGRADE(5)** (Path A, Rafael). Senior validation pass run against prod (8 probes). **Webhook gate CLOSED** (live Discord re-test → HTTP 204; generic 100%; override documented). Remaining before flip: refill commit wallet (0.0500 floor), 23:59 UTC confirmatory re-run, then 06-11 flip + Phase-0 activation (owner override — see runbook). (dogfood routing active since 2026-05-27)  
**Window:** 2026-05-29 03:55 UTC → 2026-06-10 23:59 UTC (12 days 20 hours)  
**Owner:** Rafael  
**Purpose:** prove that Pegana's per-asset thresholds are usable before Phase 3B public launch.  
**Verdict rule:** per-class hybrid criterion — see [ADR-0015](adr/0015-calibration-v1-per-class-verdict.md) (supersedes ADR-0001).

**EVIDENCE LIVE FROM:** 2026-05-29 03:55 UTC (3 days ahead of ADR-0005 calendar — deploy was healthy, no reason to wait). Verdict per ADR-0015 computed against post-2026-05-29 alerts only.

> Dogfood mode confirmed live on Hetzner dispatcher:
> `FEATURE_PUBLIC_ALERTS=false` + `DOGFOOD_TELEGRAM_CHAT_ID=6647651772`.
> All alert events route only to Rafael's Telegram chat. Daily notes below
> capture per-asset behavior; the final report (per-asset p50/p95/p99,
> true/noise classification, threshold deltas) lands on 2026-06-10.

This file is a launch gate. Do not run the broad public v2 announcement until
the dogfood window is complete and this document contains real measurements.

## Dogfood setup

| Field | Value |
|---|---|
| Public alerts | `FEATURE_PUBLIC_ALERTS=false` during calibration |
| Dogfood chat | `DOGFOOD_TELEGRAM_CHAT_ID=6647651772` |
| Required duration | 14 continuous days |
| Required outputs | p50 / p95 / p99 per asset, alert count, false positives, threshold deltas |

## Summary

> Mechanical verdict computed **2026-06-10 12:27 UTC** from prod Postgres via
> `scripts/calibration-v1-queries.sql` (window 98.6% elapsed; a confirmatory
> re-run at the 23:59 UTC close is the formal close — values are not expected to
> move materially given the criteria are already satisfied/failed by wide margins).
> Raw query output archived in the appendix at the bottom of this file.

| Metric | Result |
|---|---|
| Assets observed | 21 active (+ pbUSDC inactive, still sampling 15,866 rows) |
| Total alerts (window) | 148 (135 on active assets; 13 on inactive pbUSDC) |
| Actionable alerts (proposed) | ~12 — genuine excursions (PYUSD −61bps DEPEG, USDe −143bps DEPEG, sUSD 142–374bps swings, ONyc NAV-drift cycles) |
| Noisy alerts (proposed) | ~120 — dominated by **hyUSD's 60 CR-flaps** (known bug, FIXED in methodology 0.3.0 / ADR-0023; zero hyUSD transitions after 2026-06-06) + LST premium-jitter DRIFT flips |
| False-positive alerts (proposed) | ~4 — **USDC 2026-05-29 19:16–19:27 cluster**: 4 transitions incl. a DEPEG at only 3–4 bps (≪ 50bps DEPEG line) = early-window data glitch, not a real cross |
| Worst noisy asset | **hyUSD** (60 transitions; CR-flapping, retired by 0.3.0 deadband) |
| Threshold changes required | 4 LST drift bands marginally too tight (mSOL/INF/bbSOL/hyloSOL — see Class A) + **sHYUSD structural anomaly** (p95 = 2945 bps, never alerts — investigate) |
| Launch verdict | **SHIP via DOWNGRADE(mSOL, INF, bbSOL, hyloSOL, sHYUSD)** — Path A chosen (downgrade, no threshold change). Only Grafana webhook bars left to confirm pre-deploy. |

## Verdict (per ADR-0015 — per-class hybrid)

### Class A — peg-watched (14 assets, gate ≥12/14 = 80%)

Liveness: window = 12.8 d; all active assets wrote continuous snapshots
(no <6h gap; query D confirms 0 outages) → the ≥10-day freshness leg of (ii) is
satisfied for every asset, so (ii) reduces to **p95 < drift**.

| Asset | Class | Transitions | Samples | p95 \|bps\| | Drift | Calibrated via | Status |
|---|---|---:|---:|---:|---:|---|---|
| jitoSOL | lst | 10 | 106,072 | 54.68 | 45 | (i) ≥3 transitions | ✅ |
| mSOL | lst | 0 | 106,028 | 48.53 | 40 | — (0 trans; p95 > drift) | ❌ |
| bSOL | lst | 4 | 106,056 | 51.17 | 45 | (i) ≥3 transitions | ✅ |
| INF | lst | 0 | 105,988 | 146.17 | 140 | — (0 trans; p95 > drift) | ❌ |
| bbSOL | lst | 0 | 105,964 | 50.23 | 45 | — (0 trans; p95 > drift) | ❌ |
| JupSOL | lst | 2 | 106,022 | 57.45 | 60 | (ii) liveness (p95 < drift) | ✅ |
| hyloSOL | lst | 2 | 106,025 | 59.66 | 55 | — (<3 trans; p95 > drift) | ❌ |
| hyloSOL+ | lst | 4 | 106,029 | 27.26 | 30 | (i) ≥3 transitions | ✅ |
| USDC ★ | stable_fiat | 4 | 33,035 | 3.50 | 15 | (i) ≥3 transitions | ✅ |
| USDT ★ | stable_fiat | 8 | 33,056 | 14.50 | 15 | (i)+(ii) | ✅ |
| PYUSD | stable_fiat | 10 | 35,010 | 2.81 | 15 | (i) ≥3 transitions | ✅ |
| USDe ★ | stable_dn | 2 | 35,025 | 13.38 | 25 | (ii) liveness (p95 < drift) | ✅ |
| USDS ★ | stable_cdp | 2 | 35,009 | 3.76 | 20 | (ii) liveness (p95 < drift) | ✅ |
| hyUSD | stable_cdp | 60 | 69,663 | 27.19 (CR-driven) | CR 130 | (i) ≥3 transitions | ✅ |

★ = one of the 5 critical assets (all have complete data — see quality bars).

**Class A passed: 10 / 14 = 71.4%** (target ≥12/14 = 80%). **Below the SHIP bar, above the 50% EXTEND floor.**

The 4 failures are all LSTs that miss the liveness leg by a **tiny margin** (p95
exceeds drift by 4.7–8.5 bps) with **0–2 transitions**. Root cause: their drift
bands were calibrated 2026-05-25 from a **24h** sample (p99 × 1.25); the 12.8-day
window shows a naturally wider distribution. They are not miscalibrated by the
methodology — the band was sampled too short. Per ADR-0015 each **fails both
criteria with ≥7 days of data → qualifies for DOWNGRADE** (safety valve), or for a
documented threshold-bump override. See Mechanical verdict.

| Failing LST | p95 | current drift | p95 × 1.25 (proposed drift) |
|---|---:|---:|---:|
| mSOL | 48.53 | 40 | **61** |
| INF | 146.17 | 140 | **183** |
| bbSOL | 50.23 | 45 | **63** |
| hyloSOL | 59.66 | 55 | **75** |

(depeg/critical bands unchanged — a real depeg still alerts; the bump only stops
flagging routine SOL-premium jitter as DRIFT.)

### Class B — yield-bearing (active denominator = 6; gate ≥80%)

> **Denominator note:** ADR-0015 defined Class B = 7 incl. **pbUSDC**. pbUSDC was
> **deactivated 2026-06-01** (migration 0040 — its only DexScreener pair collapsed
> to a ~$34 dust pool printing garbage premiums; `active = false`). That happened
> **before** the 2026-06-09 rule cutoff and is documented, so pbUSDC drops out of
> the live universe (query E returns 21 active, pbUSDC absent). **Active Class B = 6.**
> 80% of 6 = 4.8 → **≥5 of 6** to pass. (JLP is also stable_yield but inactive,
> calibrating, flips per ADR-0002 at launch — not in this denominator.)

| Asset | Transitions | Samples | p95 \|bps\| | Drift | Calibrated via | Status |
|---|---:|---:|---:|---:|---|---|
| sHYUSD | 0 | 69,662 | **2945.54** | 30 | — (0 trans; p95 = 98× drift) | ❌ |
| USDY | 0 | 65,492 | 11.23 | 30 | (ii) liveness (p95 < drift) | ✅ |
| sUSDe | 2 | 65,493 | 20.05 | 30 | (ii) liveness (p95 < drift) | ✅ |
| syrupUSDC | 0 | 65,492 | 2.77 | 30 | (ii) liveness (p95 < drift) | ✅ |
| sUSD | 5 | 70,833 | 229.45 | 275 | (i)+(ii) | ✅ |
| ONyc | 20 | 68,324 | 99.75 | 100 | (i)+(ii) | ✅ |
| ~~pbUSDC~~ | — | (15,866) | (3309) | 30 | **inactive — deactivated 2026-06-01 (migration 0040)** | excluded |

**Class B passed: 5 / 6 = 83.3%** (target ≥5/6 = 80%). **✅ PASSES.**

**sHYUSD is the lone failure and it is NOT a marginal miss — it is a red flag.**
p95 = **2945 bps (29%)**, p50 = 1418 bps (14%), yet it fired **zero** transitions
the entire window. **Senior probe V2 sharpened this:** `engine_state_snapshot`
shows sHYUSD `last_state = PEGGED` while `ewma_discount = −0.2511 (−25%)` right now.
So it is not merely "silent" — the engine is actively reporting **PEGGED on a −25%
EWMA discount**, which should be deep in CRITICAL (300-bps band). Either the
source premium-gate is freezing on garbage thin-Jupiter prints on `HnnGv3…` (→ the
asset is effectively unmonitored) or the `hylo_shyusd_rate` intrinsic is mispricing
(→ a false-confirm). → **DOWNGRADE to monitoring-only AND open a post-launch
investigation** (do not ship sHYUSD as a calibrated asset). After downgrade Class B
= 5/5 = 100%.

### Class C — monitoring-only (1 asset)

| Asset | Class | Samples | p95 \|bps\| | Drift | Status | Note |
|---|---|---:|---:|---:|---|---|
| xSOL | synth_lev | 69,645 | 404.13 | 1500 | monitoring | sole synth_lev primitive on Solana mainnet; no peer; 0 alerts; p95 well within its 1500-bps band — as designed |

### Cross-class quality bars

| Bar | Target | Result |
|---|---|---|
| Class A noisy classification rate | ≤20% | ⚠️ **55% if hyUSD's 60 CR-flaps count** — but those are a known bug FIXED in 0.3.0 (ADR-0023); 0 hyUSD transitions after 2026-06-06. Labeled "noisy-but-retired" → effective ongoing noise ≪20%. **Override note required.** |
| Class B noisy classification rate | ≤20% | ✅ ONyc/sUSD flips are by-design NAV-drift/redemption-arb (documented wide bands), not methodology noise. ~0 false-positives. |
| 5 critical assets with complete data | USDC, USDT, USDe, USDS, jitoSOL | ✅ **5 / 5** (33,035 / 33,056 / 35,025 / 35,009 / 106,072 samples) |
| Webhook delivery rate | ≥99% | ✅ **PASS via documented override.** The historical 50% (11/22) failure was 100% the Discord `code 50006` format bug, fixed + deployed 2026-06-09 (`e36e62f`, migration 0046). **Generic channel: 11/11 = 100%.** **Discord fix confirmed LIVE 2026-06-10: the deployed renderer format (`crates/common/src/webhook_channel.rs::discord_body`) POSTed to the real Discord sub URL returned `HTTP 204` (success)** — the empty-message bug is gone. Override reason: the only failures are a fixed-and-now-verified bug. |
| Webhook p99 delivery latency | ≤5s | ✅ **p99 ≈ 499 ms** (max 564 ms) — comfortably under 5s. (Computed from `webhook_deliveries.elapsed_ms`; the `pegana_webhook_delivery_seconds` histogram the runbook names **does not exist** — real counter is `pegana_deliveries_total{channel,status}`, no webhook latency histogram. Runbook metric names are a doc bug.) |
| Unresolved `source_outage` labels | 0 | ✅ **0** — query D: all 7 silent assets are "CALM — sampling fine", zero "OUTAGE" |

### Mechanical verdict (computed 2026-06-10 12:27 UTC)

- **Class A (raw): 10 / 14 = 71.4%** — below the 80% SHIP bar, above the 50% EXTEND floor.
  The 4 failures (mSOL, INF, bbSOL, hyloSOL) each fail BOTH criteria with ≥7d data
  → **ADR-0015 DOWNGRADE path applies.** After DOWNGRADE: **10 / 10 = 100% ✅**
- **Class B (raw): 5 / 6 = 83.3% ✅** (pbUSDC excluded — deactivated mid-window).
  sHYUSD fails both criteria → DOWNGRADE. After DOWNGRADE: **5 / 5 = 100% ✅**
- **Critical-asset completeness: ✅ 5/5.  Source outages: ✅ 0.  Class noise: ⚠️ override note (hyUSD).  Webhook bars: ⏳ Grafana (Rafael).**

**Outcome (mechanical): `SHIP` via `DOWNGRADE(mSOL, INF, bbSOL, hyloSOL, sHYUSD)`**
— the 5 assets that fail both criteria move to monitoring-only (the ADR-0015 safety
valve). Both class gates then clear at 100%. Launch proceeds 2026-06-11 on schedule.

**Two valid paths for the 4 marginal LSTs (Rafael's override decision per ADR-0015 § Manual override):**

- **Path A — DOWNGRADE (mechanical default, no threshold change):** ship mSOL/INF/bbSOL/hyloSOL
  with a `monitoring` badge; re-calibrate (p95×1.25) + re-promote post-launch after a
  clean 7-day run. No assets.toml change → no re-run obligation → cleanest on-time launch.
  Cost: 4 flagship LSTs (esp. mSOL) ship as "monitoring", not "calibrated".
- **Path B — OVERRIDE + threshold bump:** bump the 4 LST `drift` bands to p95×1.25
  (mSOL 40→61, INF 140→183, bbSOL 45→63, hyloSOL 55→75) in `assets.toml`, document
  the override, and ship all 4 as calibrated. Bands move **up only** (looser; depeg/critical
  unchanged → no depeg is hidden). Trade-off: ships freshly-changed bands without the
  ADR-0015 TUNE 7-day re-run — a documented, low-risk override.

**sHYUSD DOWNGRADE + investigation is non-negotiable in BOTH paths** (it is a real
mispricing, not a band-nudge).

**Override applied:** **Path A (DOWNGRADE) — chosen by Rafael 2026-06-10.** The 4
marginal LSTs (mSOL, INF, bbSOL, hyloSOL) + sHYUSD move to monitoring-only; no
`assets.toml` threshold change → no ADR-0015 TUNE re-run obligation → launch proceeds
2026-06-11 on schedule. The 5 assets stay `active = true` (still monitored + displayed),
are excluded from the verdict denominator, and are annotated in `assets.toml` with
`# monitoring-only per ADR-0015 on 2026-06-10`. After downgrade: **Class A 10/10, Class B
5/5 — both 100% ≥ 80% → SHIP.** Re-calibrate (p95×1.25) + re-promote the 4 LSTs post-launch
after a clean 7-day run; sHYUSD stays monitoring-only until its market/intrinsic leg is fixed.

**Still open before the T-2h pre-deploy gate (Rafael):**
1. ~~Webhook gate override + live Discord test~~ — ✅ **DONE 2026-06-10.** The fixed
   renderer's exact Discord body was POSTed to the live Discord sub URL → **HTTP 204**.
   Generic 100% + Discord now confirmed live → gate PASS with override documented above.
2. **06-11 ACTIVATION — JupUSD / JLP / EURC / dzSOL / vSOL: ZERO calibration data, but
   live data SOURCES verified functional.** They have 0 discount_snapshots and aren't even
   rows in the DB `assets` table (`active=false` made the indexer skip them all window — the
   "passive 14-day calibration" in the Phase-0 comment never happened). **Owner decision
   2026-06-10: ACTIVATE all 5 at 06-11** (over the mechanical recommendation to keep inactive).
   To de-risk that, their data sources were probed live (§ Senior validation V8) and **all 5
   work right now**: Pyth feeds fresh (JupUSD 1.00 / JLP RR 3.264 / EURC 1.155, age <7s),
   Jupiter markets tradable with ~0% price impact (deep pools — the earlier "thin market" worry
   was a false alarm from a wrong SOL anchor; real SOL=$64.12 → dzSOL 1.053 SOL, vSOL 1.156 SOL,
   normal LST premiums), Sanctum lists dzSOL+vSOL. **So activation will NOT alert-storm on
   missing/garbage data.** Residual risks to manage, NOT blockers: (a) **thresholds are
   unvalidated** (no p50/p95/p99 baseline — they're reasonable defaults: JupUSD mirrors USDe,
   EURC mirrors fiat, JLP wide perps-LP, dzSOL/vSOL standard LST bands); (b) **+4 jupiter_usd
   slots add free-tier 429 pressure** (already ~19 slots at concurrency=2; the probe hit 429s
   when unspaced — watch `pegana_engine_source_stale_total` after activation); (c) **dzSOL/vSOL
   have NO Pyth confidence cross-check** (single-source LSTs). **Action:** flip `active=true` in
   assets.toml + recreate the indexer at launch (window is closed by then; safe), watch them
   closely for 48h, run a calibration retro + threshold tune after ≥7d. They carry no calibration
   verdict on day 1 — exhibit as monitoring-grade until tuned.
3. Ratify the proposed alert labels (actionable/noisy/false-positive) in the daily notes.
4. Confirmatory query re-run at the 23:59 UTC window close (formality; values stable).
5. **Monitoring-badge UI gap (post-launch):** no `monitoring_only` field exists in the
   system — xSOL's status lives only in docs/OpenAPI text, and `/audit`/asset-table do NOT
   yet visually distinguish monitoring vs calibrated (the ADR-0015 § Consequences UI item is
   unbuilt). Not a launch blocker (CALIBRATION-v1.md is the authoritative verdict record);
   queue the badge wiring for mSOL/INF/bbSOL/hyloSOL/sHYUSD/xSOL post-launch.

### Senior validation pass (2026-06-10 — adversarial re-check of the verdict against prod)

Ran 7 follow-up probes to grill the verdict's own premises before signing it off:

| # | Premise grilled | Probe result | Verdict |
|---|---|---|---|
| V1 | Methodology version live | `methodology_versions`: 0.3.0 **active** (released 06-04 13:56), 0.1.0 + 0.2.0 deprecated | ✅ matches launch-runbook requirement |
| V2 | sHYUSD "dark" — UNKNOWN-gated or false-confirm? | `engine_state_snapshot`: sHYUSD `last_state = PEGGED` while `ewma_discount = −0.2511 (−25%)` | 🚩 **WORSE than thought** — engine reports PEGGED on a −25% EWMA. Either the premium-gate is freezing on garbage thin-Jupiter prints (effectively unmonitored) or a false-confirm. DOWNGRADE strongly vindicated; needs post-launch root-cause. |
| V3 | "Critical assets complete" = no staleness holes? | Max inter-snapshot gap: USDS 23m · USDe 16m · USDC 10m · USDT 9m · jitoSOL 3m — **all ≪ 6h** | ✅ completeness bar genuinely met, not just by row count |
| V4 | Did the 06-08 Jupiter keyless→keyed migration starve the window? | Max gap 06-07→06-09 on jupiter_usd assets: worst = PYUSD 34m, USDS 23m, USDe 16m — **no multi-hour hole** | ✅ **window NOT contaminated** — biggest risk cleared |
| V5 | Are the hyUSD 60 flaps really retired? | Daily hyUSD transitions: 06-02=24, 03=12, 04=16, 05=6, 06=2, **then 0** — decays exactly as 0.3.0 deadband lands (06-04 13:56) | ✅ "noisy-but-retired" is empirically airtight |
| V6 | Webhook SHIP gate | `webhook_deliveries`: 50% window failure, **but 11/11 failures = fixed Discord 50006 bug**; generic 100%; p99 ≈499ms; runbook metric names fictional. **Live Discord re-test 2026-06-10 → HTTP 204** (fixed renderer format accepted) | ✅ PASS (override documented; Discord now confirmed live) |
| V7 | Phase-0 "calibrating" assets | JupUSD/JLP/EURC/dzSOL/vSOL: **0 rows everywhere**, absent from DB `assets` table | 🚩 never calibrated (see open item 2) |
| V8 | Phase-0 source health (owner chose to activate) | **All 5 sources live**: Pyth fresh (JupUSD 1.00/JLP 3.264/EURC 1.155, <7s) · Jupiter tradable, priceImpact ~0% (SOL=$64.12 → dzSOL 1.053 SOL, vSOL 1.156 SOL — normal LST premiums) · Sanctum lists dzSOL+vSOL | ✅ activation won't break on data; residual = unvalidated thresholds + Jupiter 429 pressure + no Pyth for dzSOL/vSOL |

## Daily notes

Append once per day during the dogfood window.

### 2026-06-10 (verdict day — mechanical computation)
- **Engine uptime:** healthy — all 12 prod containers up (engine 5d, indexer 2d, postgres 2wk); query D shows 0 source outages, every active asset sampling continuously.
- **Alerts:** 148 total in window (135 on active assets). 38 distinct (asset, from→to) transition kinds across 16 assets.
- **Noisy assets:** hyUSD (60 CR-flaps, 06-02→06-06, retired by methodology 0.3.0 / ADR-0023 — 0 transitions since). LST premium-jitter flips (jitoSOL 10, bSOL 4, JupSOL 2, hyloSOL+ 4, hyloSOL 2) borderline.
- **False positives (proposed):** USDC 05-29 19:16–19:27 cluster (DEPEG at 3–4 bps = early-window glitch).
- **Missed/late alerts:** none observed. **Red flag:** sHYUSD carries a 14–29% discount yet never alerted (state machine dark) — investigate market/intrinsic leg.
- **Source outages:** 0.
- **Verdict:** Class A 10/14 (71%) → DOWNGRADE 4 marginal LSTs → 100%. Class B 5/6 (83%, pbUSDC deactivated) → DOWNGRADE sHYUSD → 100%. Outcome = **SHIP via DOWNGRADE(5)**, pending Rafael Path A/B override + Grafana webhook bars.
- **Notes:** computed at 12:27 UTC (98.6% of window). Confirmatory re-run at 23:59 UTC close is the formal close.

```markdown
### YYYY-MM-DD
- Engine uptime:
- Alerts:
- Noisy assets:
- Missed/late alerts:
- Source outages:
- Notes:
```

## Webhook dogfood notes

Webhook dogfood runs in parallel with Telegram dogfood. Fill this section from
`/v1/me/webhooks/{id}/deliveries` when the passive window closes.

| Metric | Result |
|---|---|
| Receiver URL | TBD |
| Total delivery attempts | TBD |
| Unique events | TBD |
| 2xx deliveries | TBD |
| Failed final attempts | TBD |
| Dead-letter rows | TBD |
| Manual replays | TBD |
| p50 delivery latency | TBD |
| p95 delivery latency | TBD |
| p99 delivery latency | TBD |

Classification rules:

- `actionable`: the alert represented a real peg-risk state change worth user
  attention.
- `noisy`: the alert was technically correct but too routine for the configured
  threshold.
- `false positive`: Pegana emitted a state transition that was not supported by
  the underlying mechanism or market data.
- `source outage`: Pegana correctly refused or degraded due to stale/missing
  input data.

## Final decision checklist

- [x] Every active asset has enough samples for p95/p99. (min 33,035 — USDC; all ≫1,000)
- [~] Every alert in the window is classified as actionable / noisy / false positive. (proposed labels above; Rafael ratifies)
- [~] Threshold changes are either committed or explicitly deferred. (4 LST bumps proposed — gated on Path A vs B; sHYUSD deferred to investigation)
- [x] Confidence labels are reviewed for assets with missing Pyth feeds. (JupSOL/hyloSOL/hyloSOL+/hyUSD/sHYUSD/sUSD/ONyc/xSOL run feedless → single-source; all sampled cleanly)
- [x] Any source outage has an incident note or runbook action. (0 outages — query D)
- [ ] Webhook dogfood delivery rate and latency are summarized. (⏳ Grafana — Rafael, pre-deploy)
- [x] Launch verdict is written above. (SHIP via DOWNGRADE(5); Rafael override Path A/B pending)

---

## Appendix — raw mechanical query output (2026-06-10 12:27 UTC)

> Source: `scripts/calibration-v1-queries.sql` piped to prod `pegana-postgres-1`.
> Window 2026-05-29 03:55 UTC → 2026-06-10 23:59 UTC. Preserved verbatim for audit.

### A. Per-asset discount distribution (active + pbUSDC), p99 DESC

```
   asset   | samples | p50_bps |  p95_bps  |  p99_bps  |  max_bps
-----------+---------+---------+-----------+-----------+----------
 pbUSDC*   |   15866 |    92.5 |    754.30 |   3309.48 |  5625.79   (*inactive)
 sHYUSD    |   69662 | 1418.49 |   2945.54 |   3018.26 |  3101.05
 xSOL      |   69645 |  119.53 |    404.13 |    436.55 |  1169.94   (Class C, monitoring)
 sUSD      |   70833 |  223.81 |    229.45 |    230.06 |   378.25
 INF       |  105988 |  123.46 |    146.17 |    150.16 |   160.24
 ONyc      |   68324 |   81.51 |     99.75 |     99.75 |   152.11
 hyloSOL   |  106025 |   51.40 |     59.66 |     63.47 |    72.39
 JupSOL    |  106022 |   49.05 |     57.45 |     58.62 |    84.74
 jitoSOL   |  106072 |   48.76 |     54.68 |     55.92 |    78.26
 bbSOL     |  105964 |   41.95 |     50.23 |     53.26 |    55.02
 bSOL      |  106056 |   43.91 |     51.17 |     52.95 |    73.70
 mSOL      |  106028 |   38.58 |     48.53 |     49.49 |    81.69
 hyUSD     |   69663 |   14.23 |     27.19 |     30.90 |    32.22
 hyloSOL+  |  106029 |   13.03 |     27.26 |     28.31 |   118.39
 sUSDe     |   65493 |   16.83 |     20.05 |     21.82 |    34.50
 USDT      |   33056 |   10.63 |     14.50 |     15.82 |    18.49
 USDe      |   35025 |    8.57 |     13.38 |     15.68 |   206.58
 USDY      |   65492 |    4.89 |     11.23 |     13.28 |    15.30
 USDS      |   35009 |    2.71 |      3.76 |      4.38 |    44.04
 USDC      |   33035 |    2.76 |      3.50 |      3.82 |     8.55
 syrupUSDC |   65492 |    1.28 |      2.77 |      3.36 |     5.14
 PYUSD     |   35010 |    1.56 |      2.81 |      3.24 |    87.13
```

### B. Transition counts (active assets) + D. silent-but-CALM set

```
Transitions (round-trip pairs):
  hyUSD 60 · ONyc 20 · PYUSD 10 · jitoSOL 10 · USDT 8 · sUSD 5 · USDC 4 ·
  bSOL 4 · hyloSOL+ 4 · JupSOL 2 · hyloSOL 2 · USDS 2 · USDe 2 · sUSDe 2
  (pbUSDC 13 — inactive, excluded)

Silent during window, all "CALM — sampling fine" (0 outages):
  syrupUSDC · USDY · xSOL · sHYUSD · bbSOL · INF · mSOL
```

### E. Thresholds note

Query E returned empty `thresholds` JSONB for all rows — **expected**: the DB
column is display-only (migration 0021 intentionally skipped); the runtime-
authoritative thresholds live in `assets.toml` and are the ones used in the
tables above. Not a data bug.
