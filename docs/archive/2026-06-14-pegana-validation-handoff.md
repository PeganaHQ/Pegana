# Pegana — Validation & Product-Review Handoff (2026-06-13 → 06-14)

> **For the next agent.** This is a self-contained handoff of a full validation session: live diagnosis, exhaustive per-asset review, an adversarial thesis/formula/monitoring validation (workflow), and a live product review (Playwright). It records what was **verified**, what was **corrected**, the **decisions proposed** (awaiting Rafael), and the **prioritized backlog**. Nothing in this session was shipped — it is analysis + decisions only.
>
> **Trust rule for whoever reads this:** several conclusions below are *corrections* of an automated workflow that overstated things. Where a claim is load-bearing it was re-verified by hand (code/sim/live). Treat anything marked ASSUMPTION as unproven.

---

## 0. One-paragraph state of the world

Pegana (peg-risk oracle for Solana) has been **public since 2026-06-11**. As of 2026-06-13/14 the public system is **safe and healthy**: 26 assets tracked, all `PEGGED`, 0 alerts/24h, 0 delivery failures, and the `monitoring_only` **egress gate is intact** (0 gated assets leak into the public `/v1/alerts` feed). The two scary Telegram alerts are both **benign**: "Phase-0 not safe to amplify: EURC" = EURC is dark because the Pyth EUR/USD FX feed is closed on weekends (the staleness gate working correctly; self-heals Sun ~22:00 UTC), and "last alert 25h ago — engine alive?" = a known false-positive heartbeat (calm market → 0 transitions). The **formula is correct**, the **engineering is senior-grade**, but the **business thesis is unvalidated** and there is **one real public trust gap (hyloSOL+, frozen signal, P0)**.

---

## 0.5 — Validation pass 2026-06-15 (corrections & status delta)

> A later session re-verified this entire doc against code/ADRs/live API. **The technical analysis held up** (formula, methodology, file:line refs, ADR-0018, the verdicts — all confirmed). But the doc has been **overtaken by events** and contains **3 real errors**. Read this before acting on anything below.

**Status delta — the doc's action items already played out (06-14):**
- ✅ **P0 #1 (contain hyloSOL+) — DONE.** `b12982c` → **migration 0049**. Live since: `monitoring_only=true`. The "one real public gap" is **closed**.
- ❌ **P0 #2 (engine freeze-detector) — TRIED & REJECTED.** `ee7301a` shipped it → false-positived in prod (flipped 7 assets incl. **public JupSOL** to UNKNOWN, ~9-min false-alert chain) → `7aadf34` reverted → **ADR-0024: "no threshold (fixed or adaptive) separates healthy-but-flat from frozen — do NOT build a discount-constancy freeze detector."** **Do not pursue this recommendation.** Containment via `monitoring_only` replaced it.
- ✅ **ONyc — also contained** (`088d74c` / migration 0050, ADR-0024 follow-up; "frozen market leg"). The doc didn't flag ONyc as a gap.
- ✅ **EURC weekend-dark — self-healed as predicted** (PEGGED again on Monday 06-15). Mechanism validated.
- **Live now (06-15):** `monitoring_only` = **13, not 11** (+hyloSOL+, +ONyc); `alerts_24h` = **9, not 0** — this `9` is the **rolling 24h window count from `/v1/stats`**. (The per-asset breakdown sUSD×6, PYUSD×4, USDS×4, JupSOL×2 sums to **16** because it's the **broader recent `/v1/alerts` feed**, not just the 24h window — the two numbers measure different spans and are *not* contradictory.) Egress gate still intact, 0 of the 13 leaked. **sUSD's 6 alerts = the exact $8k-pool false-positive risk this doc flagged — investigate.**
- **P0 #3 (signed non-event attestation)** remains open and is now the strongest still-valid recommendation.

**3 real errors in this doc (corrected inline below):**
1. **"Four states = honest publicly" is WRONG and self-contradictory.** Only the landing *headline* says "Four states." Onboarding (`onboarding-modal.tsx:546,960`: "five states") and the entire docs-site (`state-machine.mdx:11`, `hysteresis-fsm.mdx:18`, `spread.mdx:113` "`BLACK_SWAN` (spread beyond historical p99.9)…", + a full UST `CRITICAL→BLACK_SWAN` case study) advertise **FIVE** states incl. a **spread-driven** BLACK_SWAN — which the code (`state_for_bps_discount`) **cannot reach**. So this IS a real marketing-vs-code honesty gap (matches §6 P1, contradicts §2/§3's "honest publicly"). **[06-15 UPDATE] closed on branch (d86601f + 335deee), pending 0.4.0 engine deploy.**
2. **`monitoring_only` is NOT a field in `assets.toml`.** It's a JSONB flag in Postgres `assets.metadata`, set by **migrations** (0048/0049/0050) and read via SQL. P0 #1 / the quick-win "1 line in assets.toml" is the wrong mechanism — the real fix was migration 0049. (`active=false` *is* a toml field.)
3. **Minor precision:** `git_sha` → actual field is `methodology_git_sha`; ADR-0010 is about restart-durability, not the "explicit `now`" determinism (that's `transition.rs`, independently true); "industry-standard (RedStone/Chainlink/DIA)" is the author's external assertion, not in any repo doc; Pyth "600s default staleness" conflates the engine input-floor (`state.rs:124`, 600s) with the Pyth feed window (30s); "Jupiter keyed `api.jup.ag`" is prod-`.env` only (committed default is keyless `lite-api.jup.ag`; concurrency=1 confirmed).

---

## 1. Live system snapshot (verified)

Source: `https://api.pegana.xyz/v1/{assets,alerts,stats}` + frozen snapshot `/tmp/pegana_canon.json` (regenerate via `/tmp/pegana_canon.py`).

- **26 assets, all PEGGED**, fresh (age 1–29s). `assets_in_drift=0`, `alerts_24h=0`, delivery `sent=0/failed=0`.
- **11 `monitoring_only`** (egress-gated): `EURC, INF, JLP, JupUSD, bbSOL, dzSOL, hyloSOL, mSOL, sHYUSD, vSOL, xSOL`. Migration 0048 set = matches live 11/11.
- **Public alert feed (recent)**: only `ONyc, PYUSD, hyloSOL+, sUSD` — all public-tier, **0 monitoring_only leaked** (gate holds; re-verified live multiple times).
- **EURC = DARK** (`state=null`, `discount=null`, `updated_at=null`). Weekend FX (Pyth EUR/USD closed Fri ~22:00 → Sun ~22:00 UTC). Per-asset page correctly shows **Unknown** (not false-PEGGED). `monitoring_only` → contained.

### Per-asset anomalies (the only non-trivial ones)
| Asset | Issue | Public? | Severity | Notes |
|---|---|---|---|---|
| **hyloSOL+** | **Frozen monitored signal** — discount pinned at +8.24bps, `1 distinct value / 25`, jitter 0, while `market_usd` swung ~13bps across **6/6 time-spaced samples**. `pyth_feed_id=""` (single-source). | **YES (monitoring_only=FALSE)**, already alerted publicly 06-12 | **P0** | Would NOT detect a real hyloSOL+ stress move; escapes the egress gate. THE one real public gap. |
| dzSOL | Same frozen signature (1 distinct/25) | No (gated) | Low (contained) | Don't promote until real discovery. |
| sHYUSD | Reports `PEGGED` at **~−30%** (−3016bps) | No (gated) | Low (contained) | Known source-semantics defect; should arguably be UNKNOWN. |
| sUSD | `market` pinned to a ~$8k Raydium pool, single-source, gameable for a few hundred $ | YES | Medium | False-positive risk; no liquidity-depth gate. |
| EURC | Dark (weekend FX) | No (gated) | None (by design) | Self-heals Sunday night. |

---

## 2. Methodology ground-truth (verified against code)

Files: `crates/methodology/src/{discount,ewma,thresholds,transition}.rs`, `crates/engine-rs/src/{main,state}.rs`. Docs: `docs/METHODOLOGY.md`, `docs/CALIBRATION-v1.md`, `docs/adr/`.

- **Formula:** `discount = 1 − (market / intrinsic)` (`discount.rs:36`). Positive = market **below** intrinsic (stress); negative = **premium**.
- **LSTs compute in SOL terms:** `1 − (market_sol / intrinsic_sol)` → the **Pyth SOL/USD multiplier cancels** (Sanctum & Jupiter may cache different SOL/USD). Verified live: dzSOL & vSOL move with identical Δmarket (pure SOL carrier) while discount stays pinned.
- **Direction-sensitivity (ADR-0021) — KEY:** for **LST and stable_yield**, a **negative discount (premium) is forced to PEGGED** regardless of magnitude (`thresholds.rs:17-19, 30-32`). Only the **positive (market-below-NAV)** side can trip DRIFT/DEPEG/CRITICAL. → This is why all LSTs at −53 to −152bps (which are **premiums**, market > NAV) are correctly PEGGED. It is NOT a "SOL basis" and NOT a "discount below NAV" (both earlier mischaracterizations).
- **EWMA** α=0.3 on the discount (`ewma.rs`), durable cache (ADR-0010). **confirm-up 30s / decay-down 120s** (`transition.rs`). **Schmitt deadband** 25% (bps) / 2% (CR). **Plausibility guard** `|d| < 1.0` (`discount.rs:55`) — only rejects ≥100% glitches.
- **State machine:** PEGGED→DRIFT→DEPEG→CRITICAL→(BLACK_SWAN). **`state_for_bps_discount` (thresholds.rs:159-164) has NO black_swan branch** — BLACK_SWAN is only reachable via the **CR path** (`state_for_cr`), i.e. **only hyUSD**. For the other 25 assets BLACK_SWAN is a dead enum state. **[CORRECTED 06-15]** The earlier framing here ("the public site advertises 'Four states', so this is honest publicly") is **wrong**: only the landing *headline* says "Four states" — onboarding and the docs-site advertise **five** states incl. a *spread-driven* BLACK_SWAN (`spread.mdx:113`, UST case study) that the bps path can't reach. This is a real marketing-vs-code honesty gap (see §6 P1), not just an internal dead-state. **[06-15 UPDATE] closed on branch (d86601f + 335deee), pending 0.4.0 engine deploy.**
- **Intrinsic per class:** stable_fiat/stable_dn = fixed $1; stable_yield = Pyth `.RR`/NAV; lst = Sanctum `sol_per_lst`; stable_cdp (hyUSD) = collateral-ratio path (inverted); synth_lev (xSOL) = Hylo NAV; stable_fx (EURC) = Pyth EUR/USD.
- **Calibration:** 24h sample → p99×1.25 (post-hoc proposed p95×1.25). 4 LST bands found too tight over the 12.8-day window → downgraded to monitoring_only.
- **Confidence:** conf/price <0.1%→high, <1%→medium, ≥1%→low; missing/stale→unknown.
- **Single-source assets (`pyth_feed_id=""`, no cross-check):** JupSOL, hyloSOL, hyloSOL+, dzSOL, vSOL, hyUSD, sHYUSD, sUSD, ONyc, xSOL.
- **Sources:** Jupiter keyed (`api.jup.ag`, free 0.5 RPS, concurrency 1–2, ~50s/asset tick); Sanctum `sol_per_lst` (15s poll); Pyth via Hermes (30s forward throttle, 600s default staleness, wide overrides for daily/weekly NAV feeds). Engine **skips recompute (preserves prior state) when a side is stale → asset goes dark, never falsely PEGGED**.
- **Verifiability:** every alert emits `AlertEvidence {methodology_version, methodology_git_sha, assets_toml_sha256, inputs_frozen, computed, receipt_sha256, onchain_tx_sig (SPL-Memo)}`; public deterministic replay CLI; retraction protocol (ADR-0003).

---

## 3. Corrections to the automated workflow (re-verified by hand)

The validation workflow (19 agents) was sharp but **overstated 3 load-bearing claims**. Corrected:

1. **"EWMA caps severity / a −200bps depeg never crosses CRITICAL / asymptotes at 188bps" → WRONG.** EWMA is unbiased for a constant input: a sustained depeg **converges to its true value** (sim: D=300bps reaches 299.8 by tick 20; crosses a 200bps critical band at tick **~4**). "Never crosses" is only true in the **knife-edge** case where the depeg magnitude *exactly equals* the band (measure-zero). **The real issue is LATENCY, not a cap:** ~2.5–4 min time-to-CRITICAL for a deep depeg (EWMA lag + 30s confirm + ~50s polling). Sim script logic is reproducible; redo with any α=0.3 EWMA on a step input.
2. **"3 mainnet settlements were retracted as devnet (ADR-0018)" → WRONG/unfair.** `docs/adr/0018-…-retraction.md`: the **"7" was retracted → corrected to 3 REAL early mainnet settlements** (~05-27, RPC-verified on the mainnet USDC ATA), and a **post-fix mainnet settlement was CONFIRMED 2026-05-31** (tx `4z6fHLxTnkeXq4xaE25XcSgfk3DYkNVE81Vvi8JqY6Ny…`, +0.001 USDC, Solscan-verifiable). The mainnet x402 path is **real and verified**. The correct, narrower critique: those settlements are **self-issued dogfood** (`ping_paid`, `c3-soak.ts`), **not external paying customers** → "zero *external* demand" stands, but the traction is **not fake**.
3. **"BLACK_SWAN unreachable for 25/26" → TRUE (verified).** Dead enum state for the bps path; reachable only via the CR path (hyUSD). **[CORRECTED 06-15]** The "public site says 'Four states' so it's not a public lie" qualifier was wrong — onboarding + docs-site advertise **five** states incl. a spread-driven BLACK_SWAN the code can't produce, so it IS a public honesty gap → wire the branch or stop advertising the 5th state (§6 P1). **[06-15 UPDATE] closed on branch (d86601f + 335deee), pending 0.4.0 engine deploy.**

Plus a **thesis nuance**: "lending/perps already get the primitive free via Pyth confidence intervals" is strong for the **majors**, but Pyth's confidence interval is **not** the same as Pegana's market-vs-NAV basis monitoring for **long-tail LSTs / yield wrappers** (where you must pipe the NAV anchor). So the build-not-buy attack is weaker on the breadth/long-tail wedge.

---

## 4. Validation verdicts

| Axis | Verdict | One line |
|---|---|---|
| **Thesis / business** | 🔴 **WEAK (unfalsified)** | Real, costly problem (ezETH/stETH = $50–200M cascades), but **0 external demand validated** (empty CRM, DRAFT pricing, /pricing hidden); highest-WTP buyers (lending/perps) compute the majors' signal for free; chosen rails ($29/$99 SaaS + sub-cent x402) misaligned with how risk feeds monetize (Chaos/Chainlink enterprise + revenue-share). Stays unfalsified because **nobody was asked to pay**. |
| **Formula** | 🟢 **STRONG (1 caveat)** | `discount=1−market/intrinsic` correct & implemented; measuring vs **intrinsic NAV** (not fixed $1) is the only correct path and is industry-standard (RedStone/Chainlink/DIA); LST premium carve-out economically defensible (every damaging LST event was a *discount* crash). **Caveat:** the same carve-out + loose `|d|<1` guard let sHYUSD publish PEGGED at −30% — contained only by the egress gate, not by the formula. |
| **Monitoring** | 🟡 **ADEQUATE** | Classifier faithful (0 misclassifications re-applying methodology live), egress gate intact, EURC-dark is the gate working. BUT source redundancy is **inverse to risk** (multi-source on USDC/USDT; single-source on the illiquid yield/LSTs where risk lives), and **hyloSOL+ is a public frozen-signal asset**. |
| **Product** | 🟢 **STRONG (8.2/10)** | Verified live: 0 console errors, all 200, real-time, chart renders fine (canvas), **honest dark-state UX** (EURC→Unknown), excellent 404, full mobile parity, deep asset-detail. Gaps: no freeze-detection (frozen data shows confident PEGGED), chart guide-lines drawn on the non-triggering premium side, premium/discount copy bug, aggregate `by_state` over-counts dark EURC. |

**Global:** excellent engineering for a product that **hasn't yet proven it's a company**. Formula correct, public system safe today; what's missing is **proof of a paying buyer** and closing **2–3 public credibility gaps**.

---

## 5. Product review (live, verified) — scorecard

Onboarding 8 · Core 8 · **Error-handling 8.5** · IA 8.5 · Visual 8 · **Performance 8.5** · Accessibility 7.5 · **Feature-completeness 8.5** → **Overall 8.2/10 (Strong)**.

- **Strengths:** honest degraded-state (EURC dark → "Unknown / No signal / waiting on a fresh sample / Price unavailable"); depth/craft of asset-detail (proximity-to-depeg gauge, Legs mode, recovery-confidence, exit-liquidity with real route + slippage + arb-hint); `/status` (per-source 90-day uptime + permanent incident log); engineering health.
- **The one real product gap:** **frozen-but-fresh data** (hyloSOL+: `updated_at` advances, value pinned) shows "Pegged · High" with no warning — whereas **absent** data (EURC) correctly degrades to "Unknown". The honest-Unknown pattern **already exists**; extend it to the frozen case (= the engine freeze-detector below).
- **Smaller, verified:** chart draws drift/depeg guide-lines on the **premium side** of direction-sensitive assets (they never trigger there — misleading; matches the known pre-existing chart bug); jitoSOL copy says "secondary-market **discount**" while the header correctly says "**premium** to NAV"; `/status` + `/v1/stats` count dark EURC as "PEGGED 26" (aggregate over-count) even though the per-asset page says Unknown.

---

## 6. DECISIONS — proposed, awaiting Rafael's sign-off

### Strategic (changes direction — Rafael's call, NOT shipped)
1. **Reposition** from "real-time alerts/SaaS" → **verifiability-as-settlement** for buyers who **can't self-compute**: depeg insurance + prediction-markets/dispute-resolution (long-tail LST/yield breadth as support). Alerts/feed become the free top-of-funnel, not the thesis.
2. **Demand-test gate:** send the 7 outreach the README already lists; treat **one paid pilot / signed integration as the prerequisite** for any further feature build. Cheapest way to falsify the thesis this week.
3. **Revert ADR-0011** so the verify/settle tool is the paid product (it's the one non-commoditizable wedge), feed/alerts stay free for acquisition.

### Technical (recommended; mark engine-touching ones — they need `deploy.sh` recreate, NOT during a calibration window)
- **P0 — contain hyloSOL+** → ✅ **DONE 06-14 (migration 0049).** *[CORRECTED] `monitoring_only` is a DB-metadata flag set by migration, NOT a field in `assets.toml` — the "1 line in assets.toml" instruction was wrong. `active=false` is the toml lever; `monitoring_only` is the migration lever.*
- **P0 — freeze detector in the engine** → ❌ **REJECTED 06-14 (ADR-0024).** Shipped (`ee7301a`), false-positived 7 assets incl. public JupSOL, reverted (`7aadf34`); no fixed/adaptive `series_distinct_count` threshold separates healthy-but-flat from frozen. **Do not build this.** Containment via `monitoring_only` (P0 #1 path, applied to hyloSOL+ and ONyc) is the accepted alternative.
- **P0 — signed non-event attestation / heartbeat** → periodically commit "at T, asset X = PEGGED, inputs=…" so the on-chain ledger also attests **non-events**; otherwise a false-negative emits no receipt and the ledger is silent exactly when it matters. *(This is what makes "verifiability-as-settlement" defensible.)*
- **P1 — confidence gate** → single-source / sub-$50k-pool / frozen inputs cannot carry HIGH (cap at MEDIUM).
- **P1 — per-class NAV-sanity gate** → e.g. `stable_yield` raw `|discount|` > ~300–500bps → UNKNOWN (bad-intrinsic), so the sHYUSD-class masking can never reach a public calibrated asset.
- **P1 — EWMA latency** → publish raw + smoothed; escalate CRITICAL on raw-with-short-confirm (or a parallel CUSUM); document time-to-detection per band. (Not a "cap" — a latency fix.)
- **P1 — marketing honesty** → wire the bps black_swan branch OR stop advertising a 5th state; document that Pegana detects the **discount** (cascade-causing) side, not premium-side risk; "Five sources" is not uniform robustness. **[06-15 UPDATE] closed on branch (d86601f + 335deee), pending 0.4.0 engine deploy.**
- **P2 — vol-adjusted bands** (retire 24h→p99×1.25); a separate **backing-health signal for delta-neutral** stables (USDe's $1 intrinsic is blind to funding-rate backing risk).

### Product quick-wins (<1 day, low-risk)
- Fix premium/discount copy on negative-discount assets.
- Exclude Unknown/dark assets from the `by_state` PEGGED count (`crates/api-rs/src/routes/stats.rs:127-141` — note: the no-freshness-bound is *deliberate* per the code comment + `/readyz` backstop; the nuance is multi-day-dark EURC, not momentarily-behind). *[06-15: moot while EURC is live again; still a latent over-count for the next weekend FX-dark window.]*
- ~~Contain hyloSOL+~~ ✅ done (P0 #1, migration 0049).
- Chart: don't draw drift/depeg guide-lines on the premium side of direction-sensitive assets.
- Silence the console error on the `/asset/<unknown>` 404 fetch.

---

## 7. Carry-over backlog (from the earlier full-asset review, still open)
discount_snapshots cadence (dzSOL/hyloSOL+ frozen series root-cause) · recalibrate LST monitoring_only bands p95×1.25 (INF→~183, bbSOL→~63, hyloSOL→~75, review mSOL=40) · heartbeat proxy → `stale_snap` in `scripts/calibration-watch.sh` · document the EURC weekend-dark window in `assets.toml` + exclude the FX gap from EURC's 7-day retro denominator · consolidate the egress gate into a shared `pegana_common` helper (currently duplicated in ~5 places) · Phase-0 7-day retro for JupUSD/JLP/EURC/dzSOL/vSOL (provisional/inherited thresholds).

---

## 8. Grill questions for the founder (unanswered — decide product direction)
1. Name a buyer who needs this signal AND can't compute it for free.
2. One piece of evidence that any human/agent will pay for THIS data — if none, why build more feed instead of sending the 7 outreach?
3. How do you sustain a paid subscription for a feed that's silent 360+ days/year?
4. Show the number: a sustained −300bps USDC depeg → time-to-CRITICAL ≈ 2.5–4 min. Defend that as "real-time" for consumers that liquidate on your signal (or accept the settlement framing, where it's fine).
5. What detects a fresh-but-frozen basis? (Nothing today — `try_recompute` has no freeze guard.)
6. Walk the on-chain receipt of a FALSE NEGATIVE: a missed depeg emits no transition → no AlertEvidence → no memo. What does a liquidated holder replay?
7. Why do hyloSOL+ (frozen), sUSD ($8k pool), sHYUSD (−30%) all carry HIGH confidence?
8. USDe `stable_dn` uses fixed $1 intrinsic, but its backing is a funding-rate delta-neutral position — is $1 the right anchor for backing risk?

---

## 9. Artifacts & pointers
- **Live snapshot:** `/tmp/pegana_canon.json` (regen: `python3 /tmp/pegana_canon.py`). Full sweep: `/tmp/pegana_full.py`. Movement sampler: `/tmp/pegana_sampler.py` → `/tmp/pegana_samples.txt`.
- **Full validation report (PT-BR, 26k chars):** `/tmp/pegana_insight.md`. Full asset-review: `/tmp/pegana_report.md`.
- **Screenshots (repo root, untracked):** `pegana-home.png`, `pegana-assets.png`, `pegana-asset-usdc.png`, `pegana-usdc-legs.png`, `pegana-eurc-dark.png` (honest Unknown), `pegana-404.png`, `pegana-status.png`, `pegana-mobile-jitosol.png` (chart renders fine), `pegana-asset-hylosolplus.png` (frozen-but-shown-pegged).
- **Key code:** `crates/methodology/src/{discount.rs:36, ewma.rs, thresholds.rs:17-19,159-164, transition.rs}` · `crates/engine-rs/src/{main.rs, state.rs}` (no freeze guard in `try_recompute`) · `crates/api-rs/src/routes/stats.rs:127-141` · `assets.toml` · `scripts/{launch-24h-watch.sh, calibration-watch.sh}`.
- **ADRs:** 0021 (direction-sensitivity + spread deadband), 0023 (CR deadband), 0010 (durable EWMA cache), 0003 (retraction), 0011 (verify free — candidate to revert), 0018 (x402 devnet/mainnet retraction — settlements are real but dogfood), **0024 (freeze-detection REJECTED — postdates this doc; supersedes P0 #2)**.
- **Memory:** see `…/memory/MEMORY.md` (project_* entries for egress gate, EWMA-zero fix, calibration verdict, launch).

## 10. Immediate next step (recommendation)
Start with **P0 #1 (contain hyloSOL+ — 1 line, low-risk, closes the only public gap)** while Rafael decides the strategic reposition (Decisions 1–3, his call). The other two P0s (freeze detector, signed non-event attestation) touch the engine → schedule a deliberate `deploy.sh --services 'engine'` recreate, never mid-calibration. Do **not** deploy on the weekend; EURC self-heals Sunday ~22:00 UTC.
