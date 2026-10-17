# ADR 0007 — Launch outreach scorecard and kill rule

**Status**: Accepted (2026-05-28)
**Context**: Trust Layer v0.1.0 Phase 13 outreach

## Problem

Phase 13 lists 5 outreach activities (Parity, StableGuard, SendAI,
DefiLlama, Twitter) as task checkboxes with no success criteria. Without
measurable outcomes:

- 2 weeks of outreach could close zero conversions while every checkbox
  shows green.
- Phase 14 (backtest) and subprojects B/C/D/E would proceed without
  evidence anyone wants them.
- "Launch succeeded" becomes a vibe call instead of a data call.

## Decision

### Tier 1 — Design partners (PRIORITY 1)

Targets: Parity, StableGuard
- Cadence: initial 06-11, follow-up 06-18, 06-25, drop on 07-02 if silent.
- Success ladder per target:
  - REPLY (any) within 14 days = `engagement`
  - INTEGRATION CALL scheduled = `qualified`
  - INTEGRATION COMMIT (they start dev) = `won`

### Tier 2 — Distribution channels (PRIORITY 2)

Targets: SendAI / solana.new, DefiLlama
- SendAI: PR merged in 30 days = `win`; rejected/ignored = `loss`
- DefiLlama: "Risk Oracle" category created = `win`

### Tier 3 — Loud channels (PRIORITY 3)

Targets: Twitter, Farcaster
- Per launch tweet (data capture only, no fail mode):
  - <50 impressions in 24h = `dud`
  - 50–500 = `baseline`
  - >500 OR ≥1 reply from account with >1k followers = `signal`

### Overall launch scorecard (published 2026-07-15)

- 0 qualified + 0 distribution win → `launch failed, regroup`
- ≥1 qualified OR ≥1 distribution win → `launch viable`
- ≥1 qualified AND ≥1 distribution win → `launch succeeded`

### Kill rule

If on 2026-07-31 the scorecard is `launch failed, regroup`:
- PAUSE feature work.
- Run a 2-week sprint to re-examine GTM (ICP may be wrong).
- Do NOT ship Phase 14 (backtest) or subprojects B/C/D/E until clarity.

## Why mechanical scorecard + kill rule and not "track only"

- A vague "launch felt good" verdict locks you into building features that
  may not have demand.
- Defining failure publicly (to self, in writing) makes the pivot decision
  cheaper later.
- Tier 1 vs Tier 3 separation keeps Twitter impressions from masking
  zero partner conversion.

## Consequences

- +0.5 day in Phase 13: create `docs/operations/launch-scorecard-2026-07-15.md`
  template, add calendar reminder for 07-15 and 07-31.
- Outreach emails should ask for specific next step (call, demo, intro)
  to make `qualified` measurable.
- A failed scorecard does NOT mean the product is dead — it means GTM was
  wrong. Engineering can continue if a new ICP emerges.

## Cross-refs

- `docs/pegana-trust-layer-v0.1.0/plans/13-phase-13-deploy-outreach.md`
- `docs/pegana-trust-layer-v0.1.0/01-business-rules.md § 6 Outreach posture`
