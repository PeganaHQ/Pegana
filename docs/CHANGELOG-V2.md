# Pegana V2 — Changelog

> ## ⚠️ HISTORICAL — superseded on 2026-07-23
>
> **This line SHIPPED.** Everything below was deployed to production on **2026-07-23** as V1
> (methodology 0.7.0). The "NOT deployed" framing throughout this file was accurate when it was
> written on 2026-07-18 and is now wrong — it is preserved as a point-in-time engineering record,
> not as current status.
>
> For current status:
> - **Developer changelog (canonical):** `docs-site/changelog.mdx` → https://docs.pegana.xyz/changelog
> - **Methodology version history:** `crates/methodology/CHANGELOG.md` → https://www.pegana.xyz/methodology
> - **Operator log:** `ROADMAP.md`
>
> Companion to `docs/ARCHITECTURE.md` (the system map) and `docs/AUDIT-V2-2026-07-18.md` (the trust audit).

## Status at a glance (as recorded 2026-07-18 — pre-deploy)

| Gate | Result |
|---|---|
| Rust workspace tests | **43 suites, 0 failed** (methodology 117, CLI 18+14, engine/indexer/api/dispatcher/xtask green) |
| `cargo fmt --all --check` | clean |
| `cargo clippy --workspace --all-targets` | **0 warnings** |
| Web | `tsc` clean · **788 vitest** · **eslint 0** |
| Prometheus alert rules (`promtool`) | **26 rules, SUCCESS** |
| **CLI byte-exact e2e** | **PASS** — the independent `pegana-replay 0.5.0` binary re-derived 3 real receipts (USDe Critical→Depeg, bSOL Pegged→Drift, INF Drift→Pegged); recomputed canonical hash == stored hash byte-for-byte |
| Backtest golden | byte-exact (`skip_serializing_if` keeps additive fields out of the hash) |

*As of 2026-07-18, nothing in this line was deployed. It was merged and deployed on 2026-07-23.*

---

## 1 · Trust layer & methodology (the core promise)

- **methodology 0.7.0** (mig 0066) — the pure, versioned formula core, shared byte-for-byte by the engine, the public CLI verifier, and the xtask backtest, so all three re-derive to the same verdict. Canonical hash = RFC-8785 JCS.
- **Pyth confidence gate (ADR-0032)** — force `UNKNOWN` when a required feed's conf/price exceeds 500 bps (in-hash). *"A wide oracle is not a confident reading."*
- **Intrinsic-liveness gate (ADR-0038, mig 0068)** — force `UNKNOWN` on a **frozen backing** (the 2026-04-01 dSOL failure mode), in-hash but **disabled-default** (env `INTRINSIC_LIVENESS_GATE`), provably inert + byte-exact until enabled. Coverage writers: Sanctum (corroborated directory-stale), SPL stake pools + Hylo (epoch-lag), and **Perena/USD\*** (nav-accrual-stall, calibrated live against 21d prod).
- **Verifier hardening (ADR-0033)** — a severe alert with no on-chain anchor now exits **5** (`not_applicable`), never a false `PASS`.
- **Depth-gate (ADR-0026/0034)** — confidence-cap on a thin market; in-hash, disabled-default.

## 2 · Oracles & data sources (garbage-in defense)

- **3-leg source-divergence** (mig 0067) — a third independent USD leg (Pyth oracle) alongside NAV + DEX on `/history`; honest-gated (present only where the oracle reading is independent of the DEX quote).
- **ORACLE_DEGRADED (ADR-0035)** — advisory amber badge: market↔oracle divergence, wide conf, or stale publish. **Never moves a verdict.**
- **INTRINSIC_DEGRADED (ADR-0037)** — advisory amber "backing may be frozen" badge, driven by lst-directory flags (out-of-hash).
- **LST self-audit** — realizable-vs-booked haircut tripwire (recalibrated to 300 bps off the corrected "same fact" premise) + decoded directory liveness flags.
- **Epoch-lag detectors** — SPL stake-pool + Hylo frozen-backing gauges + alerts.

## 3 · Product / frontend (V5 rebrand)

- **V5 rebrand** — coral→lavender spectrum, pills/aurora/glass, editorial-SaaS (NOT terminal/CLI); every data surface is a real semantic `<table>`.
- **market-cap** (mig 0065 + `token_supply`) — circulating-supply × price on the screener (a size/context signal, never a peg-safety input).
- **Single source of truth** — the UI now prefers the API's authoritative `assets.thresholds` + `jitter_bps_24h` over hand-maintained local re-derivations (a recalibration reflects immediately; no drift; no intra-hour smoothing on the "Most volatile" card).
- Frontend batch: calibration page, `/compare`, `/events`, per-asset detail deepening, embeddable peg badge.

## 4 · Security & safety (audit-driven)

- **[CRITICAL] Webhook SSRF fixed** — the dispatcher's reqwest client had no redirect policy → a 3xx `Location` bypassed the 5-layer `webhook_url` guard to loopback/metadata. Added `redirect::Policy::none()` + moved the URL validation **inside** the retry loop (DNS-rebind) + a cumulative Retry-After budget.
- **[HIGH] F-12 Decimal panics purged** — raw `Decimal` `/` and `*` **panic on overflow** (crash-loop DoS, reachable via the public verifier). Swept **every** crate: the methodology gate divisions, `pyth_confidence_label`, hylo's NAV formulas, and — caught by the adversarial loop — **6 raw `× price` multiplies** in the indexer (pyth/jupiter/sanctum/spl/hylo) → all `checked_div`/`checked_mul` with graceful skip. Byte-exact for valid inputs.
- **Decoder fuzzing** — proptest no-panic invariants on the 3 on-chain account decoders (perena/piggybank/spl): arbitrary bytes + valid-prefix-fuzzed numerics, reaching the arithmetic paths.
- **Cred-guard hook** — blocks `.env`/key dumps (Read/Edit/Write + Bash raw-dumps).

## 5 · Testing & validation (how we know it holds)

- **Multi-agent adversarial audits** — the V2 line was validated by repeated read-only adversarial loops (33-agent deep audit → fixes; per-decision falsification loops that caught real defects: the F-12 raw-`*` recurrence, the AlertRow dead cross-check, a Perena outage false-fire, a jitter signal-honesty gap). Each finding was re-verified 1:1 before + after the fix.
- **CLI byte-exact e2e** — an independent binary re-derives receipts to the same canonical hash (§ Status).
- **Backtest replay** — the xtask runner applies the same 4 gates in the same order as the engine + methodology; the golden output is byte-exact.
- **Calibration honesty** — the intrinsic-liveness signal was calibrated LIVE (sharkSOL false-positive caught against the LST directory; Perena window calibrated off 21d of prod NAV cadence) before any gate is enabled.

## 6 · Deferred / founder-gated (not in V2 as shipped)

- ~~**The merge/deploy** itself (338 commits ahead of `main`).~~ — **done 2026-07-23.**
- **dSOL reactivation** — deliberately **split out** of mig 0064; dSOL stays deactivated + deprecated across all surfaces (Drift-exploit history).
- **Enabling the in-hash gates** (`INTRINSIC_LIVENESS_GATE`, depth-gate) — ship inert; enable only after re-calibrating against fresh prod data.
- **pbUSDC liveness** — deactivated asset; reactivation checklist recorded (monotonic-stall model, mirrors Perena).
- **Sub-B risk signals / Sub-C loop intelligence** — researched + spec'd, greenlight-gated.
