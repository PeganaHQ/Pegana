# Beta → Calibrated promotion — retro PLAN (2026-07-20)

> **Goal:** graduate the promotable subset of the **43 `monitoring_only` (beta)** assets to
> **calibrated**, taking the live calibrated count from **20 → ~56**, HONESTLY — only assets that
> pass the ADR-0015 gate AND where the engine can actually detect a real move.
>
> **Status: PLAN (not executed).** The mechanism is cheap (a metadata flip); the hard part is the
> per-asset decision, which this doc pins down. Grounded in
> [ADR-0015](../adr/0015-calibration-v1-per-class-verdict.md),
> [ADR-0029](../adr/0029-calibration-health-direction-sensitive.md), and
> [monitoring-only-promotion-criteria.md](monitoring-only-promotion-criteria.md). Template:
> `migrations/0060_promote_beta_assets_to_calibrated.sql`.

## Live baseline (verified 2026-07-20 via `GET /v1/assets` + `/v1/calibration`)

| | |
|---|---|
| Tracked live (prod, current build) | **63** |
| Calibrated (`monitoring_only=false`) | **20** |
| Beta (`monitoring_only=true`) | **43** — of which **42 read `health: ok`**, 1 (`xSOL`) `miscalibrated` |

(Prod runs the OLD build → 63, not the canon's 72; the mig-0053 expansion assets ARE live, the
mig-0064 LSTs are NOT yet — they promote in a future retro after V1 deploys + their own window.)

## The gate (ADR-0015 + promotion-criteria.md — per-asset, ALL must hold)

1. **Data completeness** — ≥7 distinct days in the trailing 8d window with fresh intrinsic **and**
   market snapshots (`<6h` between updates), **0** `source_outage` labels.
2. **Calibration — EITHER** (i) ≥3 state transitions, **all manually labelled TRUE**, **OR**
   (ii) `p95 |discount_bps| < thresholds.drift_bps` (direction-sensitive per ADR-0029: benign
   premium carved out; the `/v1/calibration` `health: ok` flag == this).
3. **Zero noise** — **0** transitions labelled `false_positive` / `noisy` in the window.
4. **Can the engine detect a real move?** (the frozen-signal check, NOT in `/v1/calibration`) —
   the asset must have a **liquid, non-single-source market leg**. A constant single-source
   discount reads PEGGED even during a real depeg → promoting it would be **dishonest**.

## The buckets (decided)

**✅ PROMOTE — pending the retro confirm (~36):** the 42 `ok` betas MINUS the exclusions below.
Estimated live calibrated **20 → ~56**.

**⚠️ EXCLUDE — frozen-signal / thin-liquidity (stay beta, honestly):**
- **eHYUSD** (API `sHYUSD`) — **HARD BLOCK**: thin-Jupiter premium carve-out freezes PEGGED on
  garbage prints (assets.toml ~279-285). Needs the market-leg root-cause fix + a clean ≥7d window.
- **hyloSOL+, ONyc** — single-source constant discount ("illiquid at a stable peg", ADR-0024); the
  engine can't detect a real move. Needs the **depth-gate (Sub-B, ADR-0034 — needs a Birdeye key)**.
- **sharkSOL** — known dust (~$141 liquidity); exclude pending the per-asset liquidity check.
- **Any other candidate** the retro's step-4 liquidity check flags as thin/single-source.

**🔒 PERMANENT beta:** **xSOL** (synth_lev, sole in class, wide bands by design; also the 1
`miscalibrated`).

## Steps (who does what)

1. **[me] Prepare the retro SQL** — adapt `scripts/calibration-monitor.sql` to emit, per beta
   asset: `p95_bps`, `distinct_days_covered`, `source_outage_count`, `false_positive_count`, and a
   per-asset **market-leg liquidity** figure (DexScreener/Jupiter route depth vs
   `DEXSCREENER_MIN_LIQUIDITY_USD`) → a mechanical **PROMOTE / HOLD** verdict per asset.
2. **[founder — prod SSH] Run the retro SQL** on prod → the confirmed promote set.
3. **[me] Write migration `0069`** — mirror 0060:
   `UPDATE assets SET metadata = metadata - 'monitoring_only' - 'monitoring_since' - 'monitoring_reason' WHERE symbol IN (<confirmed set>);`
   (idempotent) + remove the `# monitoring-only per ADR-0015 …` annotations in `assets.toml` for
   the promoted set + write the ADR-0015-required per-asset retro report.
4. **[me] Validate** — the migration touches only DB `assets.metadata`, **not** the receipt
   inputs/hash → **golden byte-exact unaffected** (same as 0060). Confirm the beta label drops on
   web (`beta` badge) / bot (🧪 footer) / webhooks (`calibration:"provisional"`) / REST rows, and
   the calibrated denominator in `/v1/calibration` + `/v1/stats`.
5. **[founder] Deploy** — `deploy.sh --migrate --config-only` (**no rebuild**; the gate reads
   metadata live). Engine/indexer need **no recreate** (unless a band re-tune shipped in the same
   window — none planned here).
6. **[later, bucket 2] The frozen-signal holdouts** — get the **Birdeye key** → ship the
   **depth-gate (Sub-B)** → hyloSOL+/ONyc graduate honestly (or stay beta with a REAL liquidity
   signal). eHYUSD needs its market-leg fix first.

## Design decisions (grilled + decided)

- **D1 — promote NOW (standalone mig 0069) vs bundle into V1 deploy?** → **Standalone migration**,
  appliable independently via `--migrate --config-only`. Improves the CURRENT live product
  immediately (20→~56 calibrated) and is forward-compatible with the V1 sequence. Founder can run
  it now or at V1 deploy.
- **D2 — the liquidity/frozen check: automated or manual?** → **Manual per-asset for this batch**
  (the depth-gate that automates it — Sub-B, ADR-0034 — isn't shipped; needs Birdeye). Flag the ≤4
  known frozen/dust + a DexScreener depth check per new-LST candidate. The depth-gate is the
  systematic fix (separate project).
- **D3 — data-completeness for recent assets?** → The mig-0064 LSTs are NOT in prod yet (prod=63,
  missing the 9 canon-extras). This batch is all **mig-0053-era** assets (≥26 days old) → the ≥7d
  gate is satisfiable. The mig-0064 LSTs graduate in a FUTURE retro after V1 deploys + their window.
- **D4 — jsonb operator validation** → the chained `metadata - 'key'` subtract is **proven by mig
  0060** (ran in prod, promoted 7 assets) + standard Postgres jsonb semantics (removing an absent
  key is a no-op ⇒ idempotent, safe to re-run). (context7's Postgres index is the C source, not the
  SQL manual — the working precedent is the authoritative validation.)
- **D5 — golden / receipt impact?** → **NONE.** The migration touches DB `assets.metadata` only,
  not the receipt inputs or `assets_toml_sha256`. Golden byte-exact unaffected — same as 0060.
- **D6 — override.** Per ADR-0015, Rafael may override the mechanical verdict with a written reason
  in the retro report.

## What this delivers

Live calibrated **20 → ~56** with **one `--config-only` migration, no rebuild**, honestly — plus a
clear, honest path (depth-gate + Birdeye) for the ~4 frozen-signal holdouts. Highest
credibility-per-effort move for the launch: the trust pitch goes from "20 calibrated" to "~56
calibrated" without over-claiming.

## Open questions for the founder

1. **Run it now, or bundle into the V1 deploy?** (D1 — I recommend a standalone `0069` so it can
   ship whenever.)
2. **Birdeye key** — get it (unblocks the ~4 frozen-signal holdouts via the depth-gate)? Cost/resource call.
3. Any **manual override** (ADR-0015 D6) — an asset you want promoted or held against the mechanical verdict?
