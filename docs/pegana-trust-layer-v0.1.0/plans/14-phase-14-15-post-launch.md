> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Phase 14+15 — Post-Launch (Backtest + Pricing Tiers)

**Spec reference**: `../01-business-rules.md § 7. Pricing rules`, `../03-asset-coverage.md`
**Status**: **DEFERRED — do NOT execute before Trust Layer v0.1.0 deployed + stable**
**Dependencies**: Phase 13 deploy complete + 7 days stable operation

---

## Why deferred

### Phase 14 — Backtest 10/10 publication
- USDe is already monitored as `StableDn` in production
- Backtest CAN run today against historical Pyth Hermes data
- BUT marketing impact is exponentially higher when paired with "and here's USDe monitored live with [n] alerts emitted this month, each verifiable via pegana-replay"
- Publishing before launch = "purely hypothetical reconstruction"
- Publishing after launch = "live + historical, fully verifiable" — much stronger story

### Phase 15 — Pricing tiers activation
- HARD RULE per `../01-business-rules.md § Hard NO list § 1`: no sub-second latency claim before calibration v1 publishes p95/p99
- HARD RULE per `§ 7. Pricing rules`: pricing tiers activate only when (a) calibration verdict = "ship" (done in Phase 0.5), (b) at least 1 design partner signed (Parity OR StableGuard committed to integration), (c) p95/p99 measured per asset
- Without (b) signed, tier prices are guesses

---

## Phase 14 — Backtest 2025-10-10 USDe publication

**Estimated duration**: 1-2 weeks (mostly data capture + narrative writing)
**Trigger**: Trust Layer deployed + stable for ≥ 7 days AND USDe has at least 1 alert in the post-launch window

### Task 14.1 — Capture Pyth Hermes historical data

**Files**: Create `docs/backtests/2025-10-10-usde-depeg/inputs.json`

- [ ] Fetch USDe/USD and SUSDE/USDE.RR Pyth feed data for Oct 9-12, 2025
- [ ] Source: Pyth Hermes historical API OR CoinGecko + DefiLlama as cross-check
- [ ] Document data sources + tolerance in README

Format:

```json
{
  "schema_version": "v1",
  "window": { "start": "2025-10-09T14:00:00Z", "end": "2025-10-12T00:00:00Z" },
  "feeds": {
    "USDe/USD": [
      { "publish_time": "...", "price": "...", "confidence": "..." }
    ],
    "SUSDE/USDE.RR": [ ... ]
  }
}
```

### Task 14.2 — Hypothetical assets snapshot + runner

**Files**:
- Create: `docs/backtests/2025-10-10-usde-depeg/assets-snapshot.toml` (USDe entry as it would have been monitored — current methodology applied retroactively)
- Create: `scripts/run-backtest.sh`
- Modify: `crates/xtask/src/main.rs` (add `backtest` subcommand)

- [ ] Write runner script that feeds `inputs.json` through methodology, emits transitions
- [ ] Capture initial output: `docs/backtests/2025-10-10-usde-depeg/methodology-output.json`
- [ ] CI gate: `.github/workflows/backtest.yml` runs on every PR, fails on output drift

### Task 14.3 — Backtest README + CI integration

**Files**: Create `docs/backtests/2025-10-10-usde-depeg/README.md`

- [ ] Narrative: what happened on 10/10/2025, what Pegana would have detected, time-to-first-alert
- [ ] Table of transitions emitted by current methodology against historical inputs
- [ ] Disclaimer: "Hypothetical backtest. No real alert was emitted on this date."
- [ ] Pair with live: "Compare to live USDe monitoring at /audit?asset=USDe"

---

## Phase 15 — Pricing tiers activation

**Estimated duration**: 1-2 weeks engineering + however long partner negotiation takes
**Triggers** (ALL must be met):
1. Phase 0.5 calibration verdict = "ship" (done at launch)
2. AT LEAST 1 design partner contract signed (Parity or StableGuard)
3. p95/p99 latency measured per asset and published in `docs/CALIBRATION-v1.md` (done at launch)
4. Phase 14 backtest published as marketing artifact (done)
5. Trust Layer in production stable for ≥ 14 days

### Task 15.1 — Activate billing infrastructure

**Files**:
- Modify: `web/app/pricing/page.tsx` (remove waitlist mode, show active tier prices)
- Modify: `docs-site/pricing.mdx` (update from "no tiers" stance to documented tiers)
- Create: API keys management (`/account/api-keys` endpoints + UI)
- Create: Stripe (or alternative) integration for tier subscriptions

### Task 15.2 — API key authentication

- [ ] New migration: `pricing_subscriptions` + `api_keys` tables
- [ ] API middleware: rate-limit per key + tier
- [ ] Documentation: `/methodology#pricing` + `/docs/api-keys`

### Task 15.3 — First paid tier announcement

- [ ] Email design partner with signed contract: "tier active, your account credentialed"
- [ ] Twitter/Farcaster post announcing pricing tiers
- [ ] Update `01-business-rules.md § 7` removing the "WHY NOT YET" disclaimer

---

## Why these are NOT in Trust Layer v0.1.0

| Item | Why deferred |
|---|---|
| Phase 14 backtest | Marketing power 10× higher when paired with live coverage |
| Phase 15 pricing | Hard rule: no pricing without measured latency + design partner |
| API keys | No revenue model active until Phase 15 |
| SIWS / wallet login | No consumer in v0.1.0; existing Telegram + x402 cover auth |
| SAS proper (vs SPL Memo) | SPL Memo delivers 90% of value at 10% of risk; SAS composability waits for partner request |

See `../01-business-rules.md § 4. OUT of scope` for the complete deferred list.

---

## When to start Phase 14+15

After Trust Layer launches (06-11), wait at minimum 7 days. Then check:

1. **Phase 14 trigger**: USDe has at least 1 alert post-launch (any state transition). Backtest can pair with live data.
2. **Phase 15 trigger**: Design partner committed (Parity or StableGuard responded positively to outreach AND signed pilot contract).

If neither trigger is met by 2026-07-15 (5 weeks post-launch):
- Re-evaluate outreach approach (different channels, different prospects)
- Consider publishing Phase 14 backtest standalone (still valuable, just less powerful pairing)
- Consider holding Phase 15 indefinitely if no paying customer signal

---

## Memory note for next session

When the user asks "what's next after Trust Layer ships?", route to:

```
docs/pegana-trust-layer-v0.1.0/plans/14-phase-14-15-post-launch.md
```

AND consult `memory/project_trust_layer_followups.md` for the full priority queue:
- Sub-project B (Risk Signals — venue-aware + oracle health)
- Sub-project C (Loop Intelligence — Kamino/Drift/Loopscale cross-protocol)
- Sub-project D (Wallet Risk — /connect command)
- Sub-project E (Predictive Signals — whale tracking, mint/burn anomaly)
- Phase 14 (this file — backtest publication)
- Phase 15 (this file — pricing tiers)
- SAS proper (replace SPL Memo)
- SIWS / wallet login

Each is its own significant work, NOT scheduled in any phase here. They get their own spec sets when their triggers fire.

---

## Cross-references

- For business rules deferring these, see `../01-business-rules.md`.
- For risks register tracking these as roadmap items, see `../13-risks-and-mitigations.md § Roadmap items`.
- For memory of full post-launch queue, see `memory/project_trust_layer_followups.md`.
