> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# Pegana Trust Layer v0.1.0 — Specification Set

**Version**: v0.1.0
**Status**: validated v5 (maximalist + LST/stablecoin coverage expansion + JupUSD)
**Target ship date**: 2026-06-11 (post-calibration v1 verdict)
**Author**: Rafael + Claude (multi-pass brainstorming + validation)

---

## What this is

Pegana Trust Layer v0.1.0 is the first major release of Pegana's verifiable peg-risk infrastructure for Solana DeFi. Every alert produced by the engine becomes:

1. **Reproducible** — the methodology is deterministic: given the same inputs and methodology version the output is always the same. The public `pegana-replay` CLI verifies each alert via canonical-hash comparison and signer-pinned on-chain anchor (tamper-evidence), rather than re-running the full computation.
2. **Explainable** — inputs, thresholds, methodology version are visible alongside every result.
3. **Verifiable** — cryptographically anchored on-chain via Solana Attestation Service; cannot be retroactively altered.
4. **Public** — receipts indexed at `pegana.xyz/audit/[id]`, syndicated via RSS, replayable offline via the `pegana-replay` CLI.

This release also expands asset coverage from **21 to 26 active assets** at launch (Phase 0 adds 5 new), with a roadmap to 32 active in Phase 14. See `03-asset-coverage.md` for full inventory.

---

## Why this exists

After the 2025-10-10 crypto crash (USDe depeg on Binance, $19B liquidations across the market), the question "would your alert have helped me?" became the central test for any risk oracle. Pegana's answer must be:

> **"Yes. And here is the receipt — verifiable offline, on-chain, in any third-party CLI."**

That's the gap this release closes.

---

## How to read these documents

**Read in this order if you are**:
- **A reviewer** approving the spec → start at `01-business-rules.md`, then `12-acceptance-criteria.md`
- **An implementer** doing the work → start at `plans/00-README.md`
- **A skeptic** verifying the trust claims → start at `05-methodology-crate.md`, then `10-distribution.md`
- **A founder** validating product direction → start at `01-business-rules.md`, then `03-asset-coverage.md`

---

## Spec files (this directory)

| File | What's inside | Length |
|---|---|---|
| `00-README.md` | This file — navigation, conventions, decision history | short |
| `01-business-rules.md` | What Pegana IS and IS NOT. Hard NO list. Calibration gates. Deploy gate. Scope decisions. | ~400 lines |
| `02-architecture.md` | System architecture diagram, component map, data flow, deployment topology | ~300 lines |
| `03-asset-coverage.md` | All 26 active assets (post-Phase 0) + 6 deferred to Phase 14. LST deep dive. JupUSD spec. Per-asset thresholds + mint validation. Ground truth from `assets.toml`. | ~600 lines |
| `04-data-model.md` | Postgres schema (`alert_evidence`, `methodology_versions`, view fixes). JSONB shapes. Migrations 0028-0031. | ~400 lines |
| `05-methodology-crate.md` | `pegana-methodology` Rust crate spec: pure functions, RFC 8785 canonical hashing, semver lifecycle | ~400 lines |
| `06-engine-changes.md` | Engine refactor: `state.rs::transition(now)`, `push_alert` audit write, Solana Attestation Service commit hook | ~400 lines |
| `07-api-surface.md` | REST endpoints: `/v1/audit/:id`, `/v1/audit`, `/v1/audit.csv`, `/v1/audit/:id/onchain`, OpenAPI changes | ~350 lines |
| `08-external-surfaces.md` | MCP tools (`verify_alert`, `subscribe_peg_events` extension), Telegram bot localization, webhook payload, embed widget | ~450 lines |
| `09-web-pages.md` | `/audit/[id]`, `/audit`, `/methodology`, `/embed/[asset]`, `/pricing`, `/agents`, OG images, layouts | ~500 lines |
| `10-distribution.md` | `pegana-replay` CLI, cargo-dist with GitHub Attestations, releases.pegana.xyz, TS+Python SDKs, RSS/Atom feeds, reproducible builds | ~500 lines |
| `11-observability.md` | Prometheus metrics, Grafana dashboards, Sentry integration, alert routing, SLO definitions | ~250 lines |
| `12-acceptance-criteria.md` | 35+ acceptance criteria, each tied to a phase + measurable success condition | ~300 lines |
| `13-risks-and-mitigations.md` | Risk register, 12 identified risks with mitigations and severity matrix | ~250 lines |

**Total spec**: ~5000 lines across 14 files. Each file is independently readable but cross-references others.

---

## Plan files (`plans/` subdirectory)

| File | Phases | Purpose |
|---|---|---|
| `plans/00-README.md` | — | Execution order, parallelization, dependency graph |
| `plans/01-phase-0-preflight.md` | Phase 0 | Pre-flight: 7 assets added to `assets.toml` (active=false), view check, calibration monitoring, webhook dogfood report (06-03), calibration v1 report (06-10) |
| `plans/02-phase-1-methodology.md` | Phase 1 | `pegana-methodology` crate (7 tasks) |
| `plans/03-phase-2-engine.md` | Phase 2 | Engine refactor (4 tasks) |
| `plans/04-phase-3-audit-persistence.md` | Phase 3 | Migrations + `push_alert` extension (6 tasks) |
| `plans/05-phase-4-api.md` | Phase 4 | REST endpoints (2 tasks) |
| `plans/06-phase-5-dispatcher.md` | Phase 5 | Dispatcher + webhook (2 tasks) |
| `plans/07-phase-6-7-bot-mcp.md` | Phases 6+7 | Bot locale + MCP tools (4 tasks) |
| `plans/08-phase-8-9-cli-distribution.md` | Phases 8+9 | `pegana-replay` + cargo-dist (4 tasks) |
| `plans/09-phase-10-web-pages.md` | Phase 10 | `/audit` web pages (1 task with sub-steps) |
| `plans/10-phase-11-lifecycle-index-og.md` | Phase 11 | Methodology lifecycle + `/audit` index + OG images + `/methodology` + `/pricing` + `/agents` (6 tasks) |
| `plans/11-phase-11M-maximalist.md` | Phase 11M | 7 maximalist features: SAS, RSS, embed, CSV, SDKs, calibration feed, reproducible builds (7 tasks) |
| `plans/12-phase-12-observability.md` | Phase 12 | Metrics + Grafana + trust strip home + launch artifacts + demo (5 tasks) |
| `plans/13-phase-13-deploy-outreach.md` | Phase 13 | Production deploy + Parity outreach + StableGuard outreach + SendAI PR + Twitter demo (6 tasks) |
| `plans/14-phase-14-15-post-launch.md` | Phases 14+15 | Backtest 10/10 publication (post-USDe-active) + pricing tiers (post-design-partner-feedback) |

**Total plan**: ~6500 lines across 15 files. Each phase is independently executable but respects dependencies.

---

## Key dates (anchor calendar) — amended per ADR-0005, ADR-0007, ADR-0009

```
2026-05-27  ──  Calibration v1 START (dogfood, pre-evidence sub-window)
2026-05-28  ──  Trust Layer spec + 14 ADRs finalized (THIS DOCUMENT SET)
2026-05-29  ──  Implementation begins (Phase 0 + Phase 1 parallel)
2026-06-01  ──  Phase 3 DEPLOYS TO PROD (FEATURE_PUBLIC_ALERTS=false)
                  ↳ all subsequent dogfood alerts get evidence rows +
                    on-chain anchors (per ADR-0005)
2026-06-03  ──  Webhook dogfood report due
2026-06-10  ──  Calibration v1 report + launch verdict (mechanical,
                  per ADR-0001; computed from 06-01→06-10 sub-window)
2026-06-11  ──  PUBLIC LAUNCH (Trust Layer ships, FEATURE_PUBLIC_ALERTS=true)
2026-06-25  ──  Methodology stability lock ends (per ADR-0009)
2026-07-15  ──  Launch outreach scorecard published (per ADR-0007)
2026-07-31  ──  Scorecard kill-rule decision (per ADR-0007)
2026-06-15+ ──  Phase 14 (backtest publication) + Phase 15 (pricing tiers)
```

**Hard rule**: no PUBLIC launch before 2026-06-10 calibration verdict. The 06-01 prod deploy is dogfood-only — see ADR-0005 for rationale. Verdict computation is mechanical — see ADR-0001 and `01-business-rules.md § "Deploy gate"`.

---

## Decision history

This document set is the result of 5 validation passes:

- **v1** (rejected): written from Explore-agent summary without reading source code
- **v2**: rewritten after reading actual engine/state/thresholds source; validated against context7 for Kamino, Drift, Pyth, Switchboard, Jupiter Lend, MarginFi, Loopscale, MCP, cargo-dist, RFC 8785
- **v3**: sequencing adjustments — Phase 0 USDe+JLP parallel calibration, deferred Phase 14 backtest, added methodology lifecycle, `/audit` index, OG images, Sigstore attestations, pre-flight `alert_events` check
- **v4** (maximalist): all "ADD SOON" features promoted to v0.1.0 — on-chain commitment, RSS feeds, embed widget, CSV export, auto-generated SDKs, calibration feed, reproducible builds
- **v5** (this set): **structural split into 14 spec + 15 plan files**, asset coverage expansion (JupUSD + dzSOL + vSOL added to Phase 0), strategic gates integrated (CALIBRATION-v1.md timeline), P0/P1 tactical items from prior session integrated, outreach work streams added

---

## Cross-file references convention

When one file references another, use this format:

> See `[file-name.md § Section Title]` for details.

When a file references a specific concept defined elsewhere, use:

> The `methodology_version` field (defined in `04-data-model.md § alert_evidence`).

This makes the dependency graph visible and grep-able.

---

## What "done" looks like

By 2026-06-11, when this set is fully implemented:

1. **26 active assets** monitored in production (up from 21). 5 new: **JupUSD, JLP, EURC, dzSOL, vSOL**. USDe and USDS were already active.
2. **Every critical alert** carries an `evidence_url`, an on-chain SAS attestation, and is replayable offline via `pegana-replay`.
3. **5 new web surfaces** live: `/audit`, `/audit/[id]`, `/methodology`, `/embed/[asset]`, `/pricing`, `/agents`.
4. **3 new APIs**: `/v1/audit/:id`, `/v1/audit.csv`, `/v1/audit/:id/onchain`.
5. **2 new MCP tools**: `verify_alert` (free), and `subscribe_peg_events` extended with `evidence_url`.
6. **Public CLI**: `pegana-replay` distributable via `curl … | sh`, Sigstore-attested.
7. **2 SDKs**: `@pegana/sdk-ts` on npm, `pegana-sdk` on PyPI.
8. **3 RSS/Atom feeds**: `/audit.xml`, `/calibration.xml`, plus the root `/feed.xml` (existing).
9. **Embed widget**: script + iframe variants for partner sites.
10. **Outreach sent**: Parity (Colosseum), StableGuard, SendAI PR submitted.

See `12-acceptance-criteria.md` for the full 35-item checklist.

---

## Going further

After v0.1.0 ships, the roadmap continues:

- **Sub-project B** (Risk Signals): venue-aware feeds, Pyth Lazer integration, oracle health monitoring
- **Sub-project C** (Loop Intelligence): Kamino/Jupiter Lend/MarginFi/Drift/Loopscale loop exposure tracking, cascade simulator
- **Sub-project D** (User Surfaces): wallet-level risk monitoring, `/connect <wallet>` Telegram command
- **Sub-project E** (Predictive Signals): whale movement tracking, mint/burn anomaly detection, TVL flow analysis

Each sub-project will have its own spec set in a sibling folder (e.g., `docs/pegana-risk-signals-v0.2.0/`).
