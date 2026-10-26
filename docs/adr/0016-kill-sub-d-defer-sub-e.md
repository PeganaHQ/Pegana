# ADR 0016 — Kill Sub-project D (wallet-level risk), defer Sub-project E indefinitely

**Status**: Accepted (2026-05-29)
**Context**: Trust Layer v0.1.0 post-launch roadmap discipline

## Problem

The post-launch sub-project queue documented in `project_trust_layer_followups.md`
includes 4 sub-projects (B/C/D/E) intended to ship after a 7-day post-launch
stability window. Pre-launch strategic review (2026-05-29) found that
Sub-projects D and E violate the product identity established in
`01-business-rules.md § 1`.

Specifically:

- **Sub-project D — Wallet-level Risk + `/connect <wallet>`**: described as
  "personalized alerts: 'Your Kamino jitoSOL/SOL loop is 3% from
  liquidation'", with a `wallet-monitor-rs` background process scanning
  positions across Kamino/Drift/MarginFi/etc.

- **Sub-project E — Predictive Signals**: whale tracking via Helius enhanced
  webhooks ("≥ $1M to CEX hot wallets"), mint/burn z-score anomaly detection.

Both directly contradict the **Hard NO list** in `01-business-rules.md § 2`:

> **Item 3**: Never expand scope to wallet/NFT/portfolio alerts. Tempting
> because it broadens audience; fatal because it dilutes the core thesis.

Sub-project D is a portfolio risk monitor by construction. Sub-project E
(whale tracking, mint/burn anomalies) drifts toward general-purpose
on-chain monitoring — the explicit "Pegana IS NOT" territory ceded to
Hexagate/Hypernative/Range per § 1.

## Decision

### Sub-project D — KILLED

The "wallet-level risk monitor" framing is removed from the post-launch
queue. It does not return.

If a related capability is needed in the future, it MUST be framed as
**"depeg cascade impact on declared positions"** — narrowly scoped to:
the user opts in to a specific Pegana-tracked asset, and Pegana surfaces
"if X depegs, your declared loop using X is at risk." That is peg-risk
extension, not portfolio tracking. Wallet scanning across all protocols
is permanently out of scope.

`/connect <wallet>` as a bot command is killed. Wallet-based identity
remains permissible only as authentication (Sign-In With Solana / SIWS)
for B2B partners, never as a portfolio aggregation interface.

### Sub-project E — DEFERRED INDEFINITELY

Whale tracking, mint/burn anomalies, TVL flow tracking are removed from
the queue. They are not re-prioritized after B/C/D feedback (since D is
killed). They remain off the roadmap until either:

1. A design partner explicitly requests one of these signals as part of
   a peg-risk integration (e.g., "we need mint anomaly as input to our
   peg-stress signal"), OR
2. Calibration data reveals that one of these signals would have
   materially improved alert quality for an existing peg event.

Neither trigger fires "we should build predictive features because
agents like predictive features."

### Sub-projects B and C — UNCHANGED

Both remain in the post-launch queue per `project_trust_layer_followups.md`:

- **B (Risk Signals)**: venue-aware feeds + oracle health. Fits "peg-risk
  oracle" because oracle health IS peg detection quality.
- **C (Loop Intelligence)**: cross-protocol cascade simulator. Frames as
  "depeg → cascading liquidation across protocols" — direct peg-risk
  extension via cascade math, not portfolio surveillance.

## Why this and not "build everything and let users decide"

The 30+ Telegram bot commands and 40+ REST endpoints already represent
moderate scope creep beyond the "minimal peg-risk oracle" framing
business rules § 1 declares. Adding wallet-level features pushes the
product into the portfolio-monitoring category where Phantom, Solflare,
Step Finance, and Sonar already operate well. Pegana cannot compete on
that ground and would dilute the verifiable-receipts trust pitch that
DOES differentiate it.

The roadmap memory was written when "expand scope opportunistically"
felt cheap. Reality after shipping: every new feature is a new
maintenance burden, a new attack surface, a new public claim to honor.
Scope discipline is a feature.

## Consequences

- **`project_trust_layer_followups.md`** must mark Sub-D as KILLED and
  Sub-E as DEFERRED-INDEFINITELY with this ADR as cross-reference.
- **`ROADMAP.md`** must reflect the kill in the post-launch queue table.
- **Future sessions** asking "what's next after Trust Layer launch?"
  must answer with B/C/Phase 14/Phase 15 paths only. Wallet/predictive
  questions get redirected to this ADR.
- **No code change required.** Sub-projects D and E were never started.
- **Bot commands `/connect`, `/portfolio`, `/wallet`** stay killed
  before they were ever introduced.

## Override conditions

This ADR can be revisited if:

1. A signed design partner (Parity, StableGuard, or similar tier 1)
   explicitly requires wallet-scoped peg-risk delivery as a contract
   term (NOT a feature request, an integration requirement).
2. Calibration v2 (post-launch) shows that a predictive signal would
   have prevented a real peg event Pegana missed.
3. Three or more inbound user requests for the same wallet-scoped
   capability with concrete use cases — and a 1-page brief written
   showing how it stays inside peg-risk framing (not portfolio).

Each trigger must be documented with the requesting party and date.

## Cross-refs

- `docs/pegana-trust-layer-v0.1.0/01-business-rules.md § 1` (product identity)
- `docs/pegana-trust-layer-v0.1.0/01-business-rules.md § 2 item 3` (Hard NO #3)
- `project_trust_layer_followups.md` (post-launch queue — must mark D killed)
- `ROADMAP.md` (must reflect kill)
- ADR-0015 (per-class verdict; orthogonal but cited for scope-discipline pattern)
