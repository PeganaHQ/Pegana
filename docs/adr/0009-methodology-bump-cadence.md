# ADR 0009 — Methodology bump cadence post-launch

**Status**: Accepted (2026-05-28)
**Context**: Trust Layer v0.1.0; behavior during the first month after launch

## Problem

Spec defines semver rules (PATCH/MINOR/MAJOR) but no cadence policy.
First month after launch will surface bugs and threshold-tweak requests.
Without a cadence:

- Reactive every-bug bumps spam the calibration feed and trigger receipt
  hash rotation that confuses integrators.
- Lazy batch bumps leave known bugs in production for days.
- No clear announcement window for breaking changes.

## Decision

Three classes with distinct cadences:

| Class | Trigger | Cadence | Calibration mini-window |
|---|---|---|---|
| **Bug fix** | Wrong output for some input | PATCH bump within 24h of confirmation; old version marked `broken`; retraction protocol fires (ADR-0003) | 24h dogfood validation before activation |
| **Threshold tweak** | Calibration data suggests a per-asset threshold needs adjustment | PATCH bump batched **weekly** (Mondays 12:00 UTC); old version marked `deprecated` | 24h dogfood validation |
| **Breaking change** | An existing pure function changes output for some input | MINOR bump (0.x → 0.x+1); 7-day announcement before activation (RSS + email to webhook subscribers) | 7-day passive run alongside current version |

### Mandatory artifacts per bump
- `crates/methodology/CHANGELOG.md` entry with `Why:` line.
- Linked incident/PR if bug-driven.
- `methodology_versions` row updated.

### Threshold-tweak batching
- Open issues collected throughout the week with the `threshold-tweak`
  label.
- Monday review: accept/reject; ship as 0.1.x PATCH; calibration feed
  publishes a "weekly tuning" entry.
- Emergency exception for thresholds whose miss-calibration is causing
  active noise (>40% noisy classification on a critical asset).

### No bump until 06-25
After launch (2026-06-11), no methodology bumps until 2026-06-25 unless
a bug is **CRITICAL** (causing wrong alerts to fire). Reason: integrators
need a stable target during the first two weeks to validate their
integration.

## Why these cadences and not "ship when ready"

- 24h SLA on bugs is the minimum aggressive enough to limit incident
  blast radius without forcing rushed fixes.
- Weekly threshold batching avoids spam without letting tweak requests
  age indefinitely.
- 7-day announcement on breaking changes lets integrators plan code
  changes, which is the table-stakes contract for "stable" software.

## Consequences

- The Monday tuning ritual becomes a permanent operational duty.
- The 24h bug SLA implies on-call posture for at least the first 30 days.
- CHANGELOG.md doubles as public-facing documentation; tone must match
  the trust pitch (factual, no marketing).
- The 06-25 stability lock is a hard rule; document it on `/methodology`
  so integrators see it.

## Cross-refs

- `docs/pegana-trust-layer-v0.1.0/05-methodology-crate.md § Versioning rules`
- ADR-0003 (retraction protocol triggered by `broken` mark)
- `docs/pegana-trust-layer-v0.1.0/13-risks-and-mitigations.md`
