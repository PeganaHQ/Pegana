# ADR-0036 — Sub-project C (Loop Intelligence): the anonymous-position data boundary

- **Status:** **ACCEPTED — variant A (distribution-only), 2026-07-24.** Founder accepted after a full study + adversarial grill (context7-verified feasibility). Confirmed parameters: **k-anonymity floor k ≥ 5**, single-position dominance suppression **~45%**, preset shock grid **{100, 250, 500, 1000, 2000} bps**, "Chaos Labs for Solana" = **internal scoping only** (never public copy). Build proceeds Kamino + Jupiter Lend v1, staged C0→C4 with a go/no-go after C1. *(Was: PROPOSED — accept-ready, founder decision required before ANY position-reading code is written. Requested 2026-07-17: "repensar antes de codar.")* No indexer/adapter code exists yet. **Validated by a 3-angle adversarial loop (2026-07-17):** the core decision (variant A = genuine in-scope cascade-math) is confirmed — it is exactly what Chaos Labs (public HF histograms), Risk DAO (scans all positions), and DeFiLlama (surfaces top-100 *individual* positions) already publish, so Pegana's distribution-only is **more conservative than every peer**. Verdict was `accept_with_refinements`: the loop found real reconstruction/differencing holes in the original 6 invariants → hardened here (invariants 1, 7, 8, 9 + niche-asset suppression). Accept once the §Consequences design-doc reconciliation is done.
- **Governs:** ADR-0016 (killed Sub-D wallet-monitor, KEPT Sub-C cascade sim), ADR-0019 (missing-data honesty invariant), `01-business-rules.md §2 Hard NO #3` (never expand to wallet/portfolio).
- **Decision owner:** founder. The build (Kamino+Jupiter v1, Dev-$49 Helius — chosen 2026-07-17) starts only after this ADR is Accepted.

## The question

Sub-C ("Chaos Labs for Solana") simulates a **cross-protocol liquidation cascade**: "if asset X depegs by N%, how much collateral liquidates and how much bad debt results across Kamino / Jupiter Lend?" A *credible* cascade model reads **every leverage position** in those protocols to build a per-asset health-factor (HF) distribution — because the cascade is driven by which positions cross their liquidation threshold at the shocked price.

ADR-0016 **killed** Sub-D (a per-wallet portfolio monitor: `/connect <wallet>`, "**Your** Kamino jitoSOL/SOL loop is 3% from liquidation", `wallet-monitor-rs` scanning positions per user) as a violation of Hard NO #3. It **explicitly kept** Sub-C, framed as "depeg → cascading liquidation across protocols — **cascade math, not portfolio surveillance**."

But Sub-C and the killed Sub-D **read the same on-chain accounts** (Kamino obligations, Jupiter vault positions). The concern that motivated this ADR: does reading *all* positions — even anonymously — drift into the killed territory? Where exactly is the line, and what guardrails keep Sub-C provably on the cascade-math side?

## The distinction — same DATA, different PURPOSE / PRESENTATION / RETENTION

The line ADR-0016 draws is **not** "which accounts you read" (both read positions). It is **what you do with them**:

| | Sub-D (KILLED) | Sub-C (this ADR) |
|---|---|---|
| **Keyed on** | a user's **wallet/identity** (`/connect <wallet>`) | **obligation/position pubkey only** — never resolved to a wallet owner |
| **Unit of output** | one user's position ("**your** loop") | a **market-level aggregate** ("**$Y** liquidates if X drops N%") |
| **Presentation** | personalized alert to the position's owner | anonymous cascade estimate on `/asset` — no "you", no per-position readout |
| **Retention** | per-user positions, standing monitor | **distribution stats only** (see Decision) |
| **Purpose** | portfolio surveillance | peg-risk quantification (cascade depth) |

Sub-D answers *"is **your** position safe?"* Sub-C answers *"how fragile is the peg of **asset X** given the leverage stacked on it?"* — the same question Chaos Labs / Gauntlet answer for a lending market, and squarely inside "peg-risk oracle."

## Decision (proposed)

**Sub-C reads anonymous, aggregate position data as cascade math — IN-SCOPE per ADR-0016 — under these binding invariants.** Adopt the **distribution-only** variant (the conservative option; recommended):

1. **No identity, ever — positive allowlist, not just a symbol blacklist.** Pegana MUST NOT store, derive, join, or surface any mapping from a position/obligation to a wallet owner. Concretely: (a) call only anonymous reserve-scoped enumeration (`getAllObligationsByDepositedReserve`), never a per-wallet accessor (`getObligationByWallet`/`getObligationByOwner`); (b) **explicitly drop the obligation `owner`/`authority` field** — the decoded `KaminoObligation.state.owner` pubkey is present in EVERY anonymously-enumerated obligation, so the `*ByWallet*` grep is necessary but NOT sufficient. The persistence layer MUST have no owner-capable column, and CI MUST grep for `owner`/`authority` reads in the adapter code and assert the schema exposes none.
2. **Distribution-only retention + k-floored counts.** Persist only **aggregate HF-bucket distributions** per `(asset, protocol)` (collateral/debt USD per HF band) and **discard position pubkeys after each rollup** — no durable per-position table (the design doc's `loop_positions` is DROPPED, §Consequences). `position_count` is itself a low-k leak → stored/served only as a **k-floored, bucketed** field (invariant 7), never a raw integer.
3. **Market-level output only.** "If X depegs N%, ~$Y liquidates, ~$Z bad debt across {covered protocols}" — never "your position", never a per-position list, never a per-wallet notification, never protocol-vs-protocol risk-ranking (invariant 9).
4. **Coverage-honest (ADR-0019) + niche-asset suppression.** Partial/stale coverage → explicit `coverage: partial`/UNKNOWN, never a falsely-precise figure (the Chaos-Labs Mar-2026 misconfigured-oracle ~$26.9M erroneous-liquidation failure mode). **Additionally:** if an asset's leverage resolves to **fewer than `k` distinct positions across ALL covered protocols**, `simulate` returns `coverage: aggregate`/UNKNOWN with a RANGE only — never a precise cascade — because a single-entity asset's "depeg X" IS a readout of that one entity (the asset proxies identity). Apply the k-floor **per snapshot across the full retention series** (suppress a cell sparse in ANY snapshot), so an observer can't assemble a per-position time-series from Pegana's own feed.
5. **Walled off from the verifiable receipt.** `loop_exposure_usd` / `simulate_depeg_impact` are advisory analytics, clearly labeled estimates — no methodology-version bump (ADR-0009 does not apply), never a receipt input, never touches the signed peg verdict.
6. **No standing per-entity monitor.** Sub-C is a periodic market indexer (~5 min sweeps), not a per-user watcher. No alert is ever keyed to a position or a wallet.
7. **k-anonymity + single-position dominance floor** *(added by the ADR-0036 validation loop — closes the singleton-bucket fingerprint).* Never persist or serve any `(asset, protocol, HF-band)` cell with `position_count < k` (**k ≥ 5**), AND suppress/merge any cell where one position holds `> ~40–50%` of the cell's collateral/debt (l-diversity). Below-threshold mass reports as `coverage: partial`. Without this, a whale in a unique `(asset, size, HF)` cell is a fingerprint anyone can match to the one on-chain obligation (owner field is public) — reconstructing the per-entity monitor invariant 6 forbids.
8. **Kill the simulate reconstruction oracle** *(added — closes the differencing attack).* `simulate_depeg_impact` accepts only a **fixed preset shock grid** (e.g. `{100, 250, 500, 1000, 2000}` bps), NOT arbitrary continuous `shock_bps`; rounds `liquidatable_usd`/`bad_debt` to coarse significant figures; returns `positions_affected` only as bucketed ranges (`<5` / `5–20` / `>50`); and is rate-limited. Otherwise sweeping continuous `shock_bps` while watching `positions_affected` step 0→1 (with a matching `liquidatable_usd` jump) binary-searches a single position's exact liquidation threshold + collateral — a reconstruction attack that defeats the bucketing.
9. **Presentation + public-copy guardrails** *(added).* (a) The `coverage` flag renders in the SAME visual unit as the headline dollar figure, with an inline "model estimate — not a verifiable receipt" label next to the number; the cascade estimate stays OFF `/audit/[id]` + out of `audit.csv`/RSS, with no shared badge iconography with signed alerts. (b) Asset X's peg is always the grammatical subject; protocol names appear only as parenthetical leverage venues — **no protocol-vs-protocol risk-ranking** ("Kamino is riskier than Jupiter Lend" is an explicit Pegana-IS-NOT). (c) **"Chaos Labs for Solana" is INTERNAL scoping framing ONLY — prohibited as public marketing/tagline/launch copy** (already rejected in `docs/chaos-vs-pegana-2026-05-27.html` + `docs/peganav2-readiness-audit-2026-05-27.md`).

Under invariants 1–9, Sub-C is categorically distinct from the killed Sub-D AND resistant to reconstruction: it is a **market microstructure measurement** (the category of DEX-depth / protocol-TVL, applied to leverage), k-anonymized, differencing-hardened, and identity-free by construction. Invariant 2 (discard pubkeys) means Pegana never even *retains* the position-level data a portfolio monitor is built on; invariants 7–8 mean the *published aggregates* can't be reverse-engineered back into one.

## Why distribution-only (not the anonymous-positions variant)

The design doc offered two in-scope variants: (A) distribution-only, (B) persist anonymous `loop_positions` rows. Both are defensibly cascade-math. **A is recommended** because:
- It maximizes distance from Hard NO #3: no per-position rows exist at rest, so there is nothing that *could* later be joined to identity or repurposed into a monitor.
- The cascade v1 (single re-pricing pass, HF-band buckets + a shared DEX slippage curve) does not need per-position granularity to be credible — the band distribution + liquidation params suffice.
- B's marginal fidelity (exact per-position ordering) is a v2 concern and can be reconsidered as an explicit amendment if the model demands it, with its own privacy review.

Cost: A slightly under-counts deep sequential cascades (bands vs exact positions) — acceptable for v1 and disclosed via the coverage flag.

## Consequences / guardrails to enforce in code (when built)

- Schema: keep `loop_exposure_snapshots` (aggregate rollup, **k-floored/bucketed `position_count`** per invariant 7); **DROP `loop_positions`** from the v1 migration under variant A. **✅ Design doc reconciled (`a3df136`):** §4 now drops `loop_positions` → the k-floored `loop_hf_distribution`, and `position_count`→`position_bucket`; the simulate model reads the HF bands, not per-position rows. (A future variant-B reintroduction of per-position rows requires a fresh privacy review PLUS invariants 7–8 as hard preconditions.)
- Adapters (`protocol-indexer-ts`): reserve-scoped enumeration only (`getAllObligationsByDepositedReserve`), never a wallet accessor. **CI invariant (necessary AND sufficient):** the build fails if `getObligationByWallet` / `*ByWallet*` / `getObligationByOwner` **OR** a read/persist of the obligation `owner`/`authority` field appears in adapter/persistence code, AND the schema is asserted to have no owner-capable column (invariant 1b — the decoded `.state.owner` is present on every anonymously-enumerated obligation, so the `*ByWallet*` grep alone is not enough). *Bonus:* Kamino's `/leverage/metrics` REST hands the aggregate leveraged TVL+counts with NO per-position read — `loop_exposure` is buildable entirely from REST; anonymous enumeration is needed only for the Tier-1 HF cascade, reduced to k-floored bucket distributions and discarded under variant A.
- `simulate_depeg_impact`: fixed preset shock grid + coarse-rounded outputs + bucketed `positions_affected` + rate-limit (invariant 8); k-floored/dominance-suppressed cells + niche-asset `UNKNOWN` (invariants 4, 7). MCP tool + REST return market aggregates only; the description states "advisory estimate, not a verifiable receipt" (invariant 9a).
- `project_trust_layer_followups.md` + ROADMAP note Sub-C proceeding under ADR-0036 variant A.

## Strongest residual risk (founder should weigh)

Even after k-anonymity (7), shock quantization (8), and output coarsening, Pegana cannot FULLY prevent a determined observer from cross-referencing its published aggregates against the fully-public, independently-enumerable Kamino/Jupiter obligation accounts (owner field included) to isolate a dominant whale loop — worst for **thinly-leveraged niche assets where the asset itself proxies a single entity**. The data is already latent on-chain, so this is a **practical-obscurity / brand-optics residual, not a novel leak**. The only fully-honest mitigation is **suppression**: whenever a single position dominates an asset's leverage, emit `coverage: UNKNOWN` with a range, never a precise cascade — accept that Sub-C will sometimes say *"we can't quantify this without singling someone out,"* and treat that as a **feature** of the peg-risk brand, not a coverage failure (invariant 4).

## Open decisions (founder)

0. ✅ **Blocking precondition DONE (`a3df136`):** the design doc is reconciled to variant A (dropped `loop_positions` → `loop_hf_distribution`; `position_count`→`position_bucket`).
1. **Accept variant A (distribution-only) + the 9 hardened invariants** as-is? (The validation loop's recommendation: `accept_with_refinements` — the refinements are now folded in above.)
2. **Confirm the parameters:** k-anonymity floor `k ≥ 5`, single-position dominance ~40–50%, the preset shock grid `{100,250,500,1000,2000}` bps — raise the bar if you want.
3. **Public copy:** confirm the invariant-9 guardrails (no protocol-vs-protocol ranking; "Chaos Labs for Solana" internal-only; `coverage` rendered in the same unit as the number).
4. Only after **Accept** + the §0 reconciliation does the Kamino+Jupiter v1 build (C0→C4, Dev-$49 Helius, go/no-go after C1) start — see `docs/design-research/2026-07-17-sub-c-loop-intelligence-DESIGN.md`.

## Cross-refs

- ADR-0016 (killed Sub-D, kept Sub-C as cascade math) · ADR-0019 (missing-data honesty) · ADR-0009 (bump cadence — N/A, out-of-hash) · `01-business-rules.md §1/§2 #3`.
- `docs/design-research/2026-07-17-sub-c-loop-intelligence-DESIGN.md` (technical plan; schema §4, model §5, the §8 founder decisions this ADR settles the first of).
