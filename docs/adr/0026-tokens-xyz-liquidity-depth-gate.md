# ADR-0026 — tokens.xyz liquidity as a depth gate (observe-first)

- **Status:** Proposed (draft 2026-06-24, pending founder review). NOT shipped.
- **Narrowed by:** `docs/adr/0034-depth-gate-phase1-confidence-cap.md` — the
  confidence-cap-only slice of Phase 1 below (never `force_unknown`) has since
  been built and is Accepted there, **shipped DISABLED by default** (opt-in
  via `DEPTH_GATE_FLOOR_USD`). This ADR's Phase 1 section otherwise stays
  Proposed — the `force_unknown` extreme described below remains deferred.
- **Context:** ADR-0024 rejected a discount-*constancy* freeze detector and named the
  correct alternative — *"the right signal is market depth, not output-constancy: a
  sub-threshold pool / no recent fills means the market leg is unreliable → cap
  confidence and/or gate the verdict"* — but parked it ("deferred to TIER 2") because
  it *"needs a depth source (Birdeye), which is key-gated"*. The engine has carried
  `liquidity_usd` as **inert** `event.extra` metadata ever since, explicitly
  *"observe first"* (`crates/engine-rs/src/state.rs:72`, unit-test
  `liquidity_is_server_only_metadata` blocks it from the discount/FSM/receipt). The
  2026-06-09 data-source backlog (#4) wanted Birdeye for exactly this. **tokens.xyz
  now supplies that depth source** (`sources/tokens_xyz.rs`) and removes the blocker
  — so this ADR records *how* (and how cautiously) we turn the parked decision on.
- **Cadence:** A verdict-affecting behaviour change → methodology bump per ADR-0009,
  on the ADR-0025 precedent (an **additive honesty guard**, conservative-only). Gated
  behind the `2026-06-25` stability lock.

## What we validated first (2026-06-24, prod)

Decisions about a depth gate are worthless without knowing the depth source's real
reach. Measured on `pegana-prod-01`:

- **Feed is live and healthy.** `indexer` Up 9h healthy; `"tokens.xyz liquidity
  published"` every 60s without gaps. The integration is real and present-tense.
- **Coverage is the binding constraint: `published: 24`.** tokens.xyz returns
  `hasMarket=true` for only **24 of 62** active mints. **38 (61%) come back
  `hasMarket=false`** — no liquidity datum at all.
- This number reframes the whole design (below). The exact 24-symbol roster and the
  liquidity *distribution* are the first output of the observe phase, not a
  prerequisite for this decision.

## Decision

Adopt the depth gate **observe-first, in two phases**, never as a flip-the-switch
threshold. ADR-0024 is the cautionary precedent: a *guessed* freeze threshold
false-positived on healthy public JupSOL within minutes of deploy.

### Phase 0 — Observe (no behaviour change; shippable now, pre-lock)

1. Expose the already-collected `liquidity_usd` for inspection (it exists in memory +
   `event.extra` today; it is **not** in `discount_snapshots.extra`, which only
   carries `threshold_kind`, nor in `/v1/assets`). Persist a periodic per-asset
   `(asset, liquidity_usd, has_market, ts)` row so the distribution can be measured
   over a real window instead of guessed.
2. After ≥1 week, answer the two questions that set every threshold: **(a)** among the
   24 covered assets, how many ever sit below a candidate floor (i.e. would the gate
   ever fire, or are all 24 deep enough to never trip)? **(b)** is the right floor
   **absolute** (a USD level below which *any* asset's price is untrustworthy) or
   **class-/asset-relative** (a $50k pool is thin for USDC, normal for a long-tail
   LST)?

### Phase 1 — Gate (post-lock, only if Phase 0 shows it fires usefully)

The gate caps confidence (`high → medium`) or, in the extreme, forces honest-dark
**UNKNOWN** — exactly the ADR-0025 / NAV-sanity shape (conservative-only; it can never
*manufacture* a confident verdict, only withhold one). It is **not** a new alert
state and **not** a number shown to users.

Hard design rules, each a lesson already paid for:

- **`hasMarket=false` is NOT a signal.** It conflates "no real market exists" with
  "tokens.xyz hasn't indexed this mint yet" — and we *just added 37 mints today*, so
  indexing lag is the likely cause for much of the 38. Gating on absence would
  false-positive on healthy, newly-listed, deeply-liquid assets. **The gate keys only
  on `hasMarket=true` + a low `liquidity` value.** Absence contributes nothing.
- **Reach ≤ the covered set (~24 today).** The gate hardens only assets tokens.xyz
  prices. The uncovered tail keeps the *existing* mitigation — containment /
  `monitoring_only` per ADR-0024 (how ONyc and hyloSOL+ are already handled). The gate
  does not graduate them; at best it lets a *covered* contained asset graduate once
  its depth is observed-adequate.
- **Floor is calibrated from the observed distribution**, never a constant pulled from
  the air (ADR-0024's exact failure). Re-validate on the **full asset population**
  before deploy.
- **Explicit freshness guard.** tokens.xyz is slow (60s) and coverage can flip; a
  stale `liquidity_usd` must read as *absent*, never gate on a stale-high or
  un-gate on a stale-low value. (The current source deliberately does not gate, so
  this guard is new work — `state.rs` already flags it.)
- **Replay before ship.** Source-methodology changes shift published states → ADR +
  `pegana-replay` diff, same bar as ADR-0023 / ADR-0025.

## Considered and rejected

- **A user-facing "liquidity score" / badge / ranking / chart.** Off-thesis: Pegana is
  a depeg *detector*, not a data terminal (the stableguard positioning brand-rejected).
  Adds a vanity number that invites "treat us as a liquidity feed". Cut.
  - *Narrow survivor, deferred:* the `safety-grade.tsx` **"Liquidity"** dimension is
    today a **static class heuristic** (`safetyGrade(symbol, klass)`, "Heuristic v1",
    no live data). Replacing fake-with-real for the 24 covered assets is the *only*
    defensible user-facing use — but it degrades to heuristic for the 38 uncovered
    (inconsistent UX) and still nudges toward terminal-creep, so it is a separate,
    later, optional call — not part of this gate.
- **Gate before observe.** The ADR-0024 mistake verbatim. Rejected.
- **`hasMarket=false` as a depeg/unreliability signal.** Indexing-lag false-positive
  risk (see rules). Rejected.
- **Single-source dependence on tokens.xyz for the gate.** Keep DexScreener depth (3
  assets) as a cross-check; a future Birdeye add is still valid where tokens.xyz has no
  market. The gate must tolerate any one depth source going dark (degrade to "absent",
  never to a false verdict).

## Consequences

- **Methodology bump** when Phase 1 ships (additive honesty guard; PATCH if strictly
  conservative, MINOR if integrators must be warned — decide at ship per ADR-0009,
  honoring or consciously overriding the 7-day announce as in ADR-0025).
- **Partnership proof point (the real near-term value).** Consuming the Foundation's
  market-snapshots API *in production* is the concrete reciprocal that de-risks the
  inbound (Pegana's peg signal → tokens.xyz, which has none). This consumption work is
  justified primarily as that proof — not as engineering on its own merit. **Do not let
  building the gate displace the demand/distribution work it is meant to support**
  (standing strategic constraint: the gap is demand, not tech). Time-box accordingly.
- Phase 0 is cheap and pre-lock-safe; Phase 1 is contingent on Phase 0's evidence and
  may resolve to "not worth building yet" if all 24 covered assets are always deep.
