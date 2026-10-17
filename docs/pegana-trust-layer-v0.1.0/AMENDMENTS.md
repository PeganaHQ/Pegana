# AMENDMENTS — Trust Layer v0.1.0

> This file overrides any contradicting statement in the spec/plan files.
> The original spec docs (`00-13`) and plan docs (`plans/00-14`) are preserved
> as historical reference. Where they differ from an ADR listed below,
> **the ADR wins**.

Generated during `/grill-with-docs` session on 2026-05-28.

---

## ADR index

| ADR | Title | Affects |
|---|---|---|
| [0001](../../adr/0001-calibration-v1-verdict-rule.md) | Calibration v1 verdict rule (mechanical) | `01-business-rules.md § 3, § 5`, `12-acceptance-criteria.md`, `plans/13-phase-13-deploy-outreach.md`, `docs/CALIBRATION-v1.md` |
| [0002](../../adr/0002-per-asset-activation-rule.md) | Per-asset activation rule for Phase 0 additions | `01-business-rules.md § 5 item 4`, `03-asset-coverage.md`, `plans/01-phase-0-preflight.md`, `plans/13-phase-13-deploy-outreach.md` |
| [0003](../../adr/0003-methodology-retraction-protocol.md) | Retraction protocol for broken methodology versions | `04-data-model.md`, `05-methodology-crate.md`, `08-external-surfaces.md`, `09-web-pages.md`, `plans/02-phase-1-methodology.md`, `plans/04-phase-3-audit-persistence.md`, `plans/06-phase-5-dispatcher.md`, `plans/07-phase-6-7-bot-mcp.md` |
| [0004](../../adr/0004-onchain-commit-policy.md) | On-chain commit retry, burst, alarm, UI policy | `04-data-model.md`, `06-engine-changes.md`, `09-web-pages.md`, `11-observability.md`, `plans/04-phase-3-audit-persistence.md`, `plans/12-phase-12-observability.md` |
| [0005](../../adr/0005-early-evidence-rollout.md) | Early evidence rollout (Phase 3 → prod on 2026-06-01) | `00-README.md`, `01-business-rules.md § 3`, `plans/00-README.md`, `plans/04-phase-3-audit-persistence.md`, `plans/13-phase-13-deploy-outreach.md`, `docs/CALIBRATION-v1.md` |
| [0006](../../adr/0006-alert-evidence-persistence-failure.md) | alert_evidence persistence failure policy | `04-data-model.md`, `06-engine-changes.md`, `07-api-surface.md`, `08-external-surfaces.md`, `09-web-pages.md`, `plans/04-phase-3-audit-persistence.md`, `plans/05-phase-4-api.md`, `plans/06-phase-5-dispatcher.md` |
| [0007](../../adr/0007-launch-outreach-scorecard.md) | Launch outreach scorecard + kill rule | `01-business-rules.md § 6`, `plans/13-phase-13-deploy-outreach.md` |
| [0008](../../adr/0008-verifier-install-verification.md) | Default install verifies Sigstore attestation | `10-distribution.md`, `09-web-pages.md`, `plans/08-phase-8-9-cli-distribution.md` |
| [0009](../../adr/0009-methodology-bump-cadence.md) | Methodology bump cadence post-launch | `05-methodology-crate.md`, `13-risks-and-mitigations.md` |
| [0010](../../adr/0010-engine-state-snapshot.md) | Engine state snapshot for restart determinism | `04-data-model.md`, `06-engine-changes.md`, `plans/04-phase-3-audit-persistence.md` |
| [0011](../../adr/0011-mcp-verify-alert-free-with-telemetry.md) | MCP verify_alert stays free, with rate limit + telemetry | `08-external-surfaces.md`, `11-observability.md`, `plans/07-phase-6-7-bot-mcp.md` |
| [0012](../../adr/0012-i18n-scope.md) | i18n scope for v0.1.0 | `08-external-surfaces.md`, `09-web-pages.md` |
| [0013](../../adr/0013-assets-toml-epoch-display.md) | Make assets.toml epochs visible in UI | `05-methodology-crate.md`, `09-web-pages.md`, `plans/10-phase-11-lifecycle-index-og.md` |
| [0014](../../adr/0014-csv-index-rate-limits.md) | Bounded /v1/audit.csv and /v1/audit index endpoints | `07-api-surface.md`, `11-observability.md`, `plans/05-phase-4-api.md` |
| [0015](../../adr/0015-calibration-v1-per-class-verdict.md) | Calibration v1 verdict rule — per-class revision (supersedes 0001) | `01-business-rules.md § 3, § 5`, `12-acceptance-criteria.md`, `plans/13-phase-13-deploy-outreach.md`, `docs/CALIBRATION-v1.md` |
| [0016](../../adr/0016-kill-sub-d-defer-sub-e.md) | Kill Sub-project D (wallet-level risk), defer Sub-project E indefinitely (re-affirms Hard NO #3) | `01-business-rules.md § 2 item 3`, `project_trust_layer_followups.md`, `ROADMAP.md` |
| [0017](../../adr/0017-pre-evidence-threshold-exercise.md) | Pre-evidence sub-window threshold exercise (issue #101 validation runs) | `docs/operations/issue-101-exercise-log.md`, `CONTEXT.md` (+2 verbetes) |
| [0018](../../adr/0018-mcp-x402-devnet-mainnet-retraction.md) | MCP x402 ran on devnet in prod — mainnet claim retraction + settlement-network invariant | `docs/operations/post-qa-execution-2026-05-29.md`, `project_x402_facilitator_block.md`, `docker-compose.yml:161`, README/marketing |
| [0019](../../adr/0019-hardening-missing-data-invariant.md) | Hardening invariant "missing data ≠ confirming data" (H1-H12) — confidence/discount/CR/staleness/receipt all degrade to a non-confirming outcome, never a false peg | `06-engine-changes.md`, `05-methodology-crate.md`, `ROADMAP.md` post-launch queue #1, source adapters |
| [0020](../../adr/0020-audit-index-gated-by-public-flag.md) | `/v1/audit` index + `/v1/alerts` + `/v1/audit.csv` gated by `FEATURE_PUBLIC_ALERTS` (web audit.xml/events.xml feeds inherit it; detail/onchain stay ungated) — keeps the calibration ledger quiet until launch; amends ADR-0005 | `07-api-surface.md`, `08-external-surfaces.md`, `09-web-pages.md`, `docs/adr/0005-early-evidence-rollout.md`, `docs/operations/deploy-2026-06-11.md` |
| [0021](../../adr/0021-lst-flapping-and-premium-false-alerts.md) | Kill LST false alerts — Schmitt-trigger magnitude deadband + LST premium carve-out (methodology **0.2.0**); activated under the ADR-0009 critical-bug exception. v0.1.0 → `deprecated` (not broken; no retraction) | `05-methodology-crate.md`, `crates/methodology/src/thresholds.rs`, `crates/engine-rs/src/main.rs`, `docs/adr/0009-methodology-bump-cadence.md`, migration `0041` |
| [0023](../../adr/0023-hyusd-cr-band-flapping.md) | Kill hyUSD CR-band flapping — CR-side magnitude deadband (`classify_cr_with_hysteresis`, methodology **0.3.0**); completes ADR-0021's deferred CR path, activated under the ADR-0009 critical-bug exception. v0.2.0 → `deprecated` (not broken; no retraction) | `05-methodology-crate.md`, `crates/methodology/src/thresholds.rs`, `crates/engine-rs/src/main.rs`, `docs/adr/0021-lst-flapping-and-premium-false-alerts.md`, migration `0044` |
| [0033](../../adr/0033-verifier-default-on-onchain-and-honesty-wording.md) | Flip `pegana-replay --alert-id` to verify on-chain by DEFAULT (`--offline` escape hatch); new exit 5 `ONCHAIN_INCOMPLETE`; honesty rewrite of every "verifies...tamper-evidence" claim in CLI/README/web copy | `10-distribution.md` (CLI surface + exit-codes table superseded), `crates/pegana-replay-cli/src/main.rs`, `tools/pegana-replay-public/README.md`, `web/components/organisms/receipt-verifier.tsx`, `web/lib/verify-receipt.ts` |

---

## Engineering budget impact

The 14 ADRs add **~5-6 days** of engineering work to the original ~14-day plan.

| ADR | Days added |
|---|---|
| 0001, 0002, 0005, 0007, 0009, 0012 | 0 (process/policy only) |
| 0003 | +0.5 |
| 0004 | +1.0 |
| 0006 | +0.5 to +1.0 |
| 0008 | +1.0 |
| 0010 | +0.5 |
| 0011 | +0.5 |
| 0013 | +0.5 |
| 0014 | +0.5 |
| **Total** | **~5.0** |

Still fits the 2026-05-29 → 2026-06-11 window (14 days) given Phase 0
runs in parallel and many ADRs add work to existing tasks rather than
new phases.

---

## Key date amendments

Per ADR-0005, the key-dates table in `00-README.md` becomes (updated to
reflect the **actual** early deploy — Trust Layer went live 2026-05-29 03:55
UTC, 3 days ahead of the planned 06-01, which ADR-0005 explicitly permits):

```
2026-05-27  ──  Calibration v1 START (dogfood, pre-evidence)
2026-05-28  ──  Trust Layer spec + ADRs finalized
2026-05-29  ──  Trust Layer DEPLOYED TO PROD @ 03:55 UTC (early per ADR-0005)
                  FEATURE_PUBLIC_ALERTS=false — evidence + on-chain commits live
                  ↳ all subsequent dogfood alerts get evidence + on-chain
2026-05-29 → 06-10  ──  Post-evidence calibration window (citable in verdict)
2026-06-03  ──  Webhook dogfood report
2026-06-10  ──  Calibration v1 report + launch verdict (per ADR-0015,
                  which supersedes ADR-0001 — per-class verdict rule)
                  ↳ verdict computed mechanically from 05-29 → 06-10 data
2026-06-11  ──  PUBLIC LAUNCH (FEATURE_PUBLIC_ALERTS=true)
2026-06-25  ──  Methodology stability lock ends (per ADR-0009)
2026-07-15  ──  Launch scorecard published (per ADR-0007)
2026-07-31  ──  Scorecard kill-rule decision (per ADR-0007)
```

> **Note (2026-05-29):** the planned 06-01 Phase 3 deploy was brought forward —
> Trust Layer actually went live on **2026-05-29 03:55 UTC**, which ADR-0005
> permits as an early evidence rollout. The post-evidence calibration window is
> therefore **05-29 → 06-10** (not 06-01 → 06-10), and the launch verdict is
> computed per **ADR-0015** (per-class rule, supersedes ADR-0001's 0001 rule).

---

## How to read the spec going forward

1. Read `00-README.md` for navigation.
2. Check this `AMENDMENTS.md` for any ADR that overrides what you're reading.
3. Read the spec/plan file with the ADRs as authoritative deltas.

The banner at the top of every spec/plan file points back here.
