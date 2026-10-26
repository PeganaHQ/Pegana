# ADR 0005 — Early evidence rollout (Phase 3 ships to prod during calibration)

**Status**: Accepted (2026-05-28)
**Context**: Trust Layer v0.1.0; calibration v1 vs Phase 13 deploy sequencing

> **Amendment (2026-05-31, see [ADR-0020](0020-audit-index-gated-by-public-flag.md)):**
> This ADR's "`FEATURE_PUBLIC_ALERTS=false` keeps surface internal" line (under
> Consequences → Mitigated by) is now realized concretely in `api-rs`: the
> public **`/v1/audit` index, `/v1/alerts` list, and `/v1/audit.csv` are gated by
> the flag** in api-rs (the web `audit.xml` / `feed/events.xml` Atom/RSS feeds
> inherit it, since they fetch those endpoints), so the
> calibration ledger stays quiet (no public listing of dogfood alerts) until the
> 06-11 launch flip. The flag does **not** gate `/v1/audit/{id}` detail or
> `/onchain` — those stay public so any specific receipt and its on-chain anchor
> remain directly verifiable during calibration. This resolves the apparent
> contradiction between "keep the surface internal" and "the report can link to
> specific `/audit/[id]` URLs anyone can verify": direct lookups were always
> meant to work; only the *discoverable index/feed* is held back. See ADR-0020
> for the full decision.

## Problem

The original sequencing put Phase 3 (alert_evidence migration + push_alert
audit write) inside Phase 13 (production deploy on 2026-06-11). That meant
the entire calibration window (2026-05-27 → 2026-06-10), whose data
justifies the launch verdict, would produce alerts with no evidence rows,
no on-chain commits, no receipts.

The verdict report would have nothing verifiable to link to. The trust
pitch would not apply to the data that justifies the trust layer's launch.

## Decision

Deploy Phase 3 to production on **2026-06-01** (day 4 of timeline) with
`FEATURE_PUBLIC_ALERTS=false` still in effect. Subsequent calibration
alerts get full evidence rows + on-chain commits while staying in
dogfood-only delivery.

Phase 13 keeps the public surface flip (`FEATURE_PUBLIC_ALERTS=true`,
audit URLs in dispatched payloads, public web pages) but the underlying
persistence is already live.

## Why early deploy and not the alternatives

- **Option B (accept the irony)** weakens the launch pitch precisely
  when scrutiny will be highest. "Trust us about the data behind our
  trust layer" is a bad opening line.
- **Option C (backtest post-launch)** creates two parallel datasets per
  alert and complicates the trust story. It also delays the audit URLs
  the calibration report can cite.
- **Option A (this)** gives ~9 days of real, replayable, on-chain-anchored
  dogfood data before launch. The calibration report can link to specific
  `/audit/[id]` URLs that anyone can verify offline with `pegana-replay`.

## Consequences

- Phase 3 must ship on 2026-06-01 (deploy gate item in `plans/04-phase-3-audit-persistence.md`).
- Phase 0 dogfood window splits into two sub-windows:
  - 2026-05-27 → 2026-05-31 (pre-evidence; data treated as informational only).
  - 2026-06-01 → 2026-06-10 (post-evidence; data citable in verdict report).
- Calibration verdict rule (ADR-0001) applies only to the second sub-window.
- Operational risk: 9 days of new code in production before public launch.
  Mitigated by:
  - `FEATURE_PUBLIC_ALERTS=false` keeps surface internal.
  - Rollback path: `DROP TABLE alert_evidence; DROP TABLE alert_evidence_commit_failures;`
    + revert engine binary.
  - Sentry capture on any `push_alert` exception.

## Cross-refs

- `docs/CALIBRATION-v1.md` (window definition)
- `docs/pegana-trust-layer-v0.1.0/plans/04-phase-3-audit-persistence.md`
- `docs/pegana-trust-layer-v0.1.0/plans/13-phase-13-deploy-outreach.md`
- ADR-0001 (verdict rule applies only to post-2026-06-01 data)
