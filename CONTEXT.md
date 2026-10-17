# Pegana — Context glossary

> Domain language sharpened during /grill-with-docs on 2026-05-28 and expanded through 44 ADRs.
> Add new terms as they are resolved in design conversations.

---

## Verdict
Calibration v1's go/no-go decision on 2026-06-10. NOT a vibe call —
mechanical per [ADR-0001](docs/adr/0001-calibration-v1-verdict-rule.md)
(superseded by [ADR-0015](docs/adr/0015-calibration-v1-verdict-rule-per-class-revision.md)):
SHIP / TUNE / EXTEND, computed from labelled dogfood data.

## Sub-window
A subset of the calibration v1 window. Distinguish:
- **Pre-evidence sub-window** (05-27 → 05-31): informational only.
- **Evidenced sub-window** (06-01 → 06-10): authoritative for the verdict.
Defined in [ADR-0005](docs/adr/0005-early-evidence-rollout.md).

## Activation (per-asset)
Promoting an asset from `active=false` to `active=true` in `assets.toml`.
Per [ADR-0002](docs/adr/0002-per-asset-activation-rule.md), activation is
decided per-asset at 06-10, not as an atomic 5-asset block.

## Retraction
A first-class signal published when a methodology version is marked
`broken`. Triggers: web banner + on-chain memo + webhook re-fire + RSS
item + bot message + API field. Defined in
[ADR-0003](docs/adr/0003-methodology-retraction-protocol.md).
NOT the same as deletion: original alert row is preserved; retraction
is additive.

## Commit status
The on-chain commit lifecycle for a critical alert. Enum per
[ADR-0004](docs/adr/0004-onchain-commit-policy.md):
`not_applicable | pending | committed | retry_exhausted | wallet_drained`.
Never `NULL` in UI.

## Evidence status
Per-alert persistence state surfaced in the webhook payload and API
responses. Enum per
[ADR-0006](docs/adr/0006-alert-evidence-persistence-failure.md):
`ready | pending | failed_permanent`. Lets consumers handle the case
where the audit URL is not yet (or never will be) live.

## Snapshot
The canonical `assets.toml` content hashed into each receipt. Changes
every time an asset is added/removed/edited. Surfaced in UI as a 7-char
short hash badge per
[ADR-0013](docs/adr/0013-assets-toml-epoch-display.md).

## Methodology bump cadence
Per [ADR-0009](docs/adr/0009-methodology-bump-cadence.md): bugs ship
within 24h (PATCH + retraction); threshold tweaks batched weekly (PATCH);
breaking changes get 7-day announcement (MINOR). Hard stability lock from
launch (06-11) through 06-25.

## Stability lock
The two-week window post-launch (06-11 → 06-25) during which no
methodology bumps ship except CRITICAL bug fixes. Lets integrators
validate against a stable target.

## Launch scorecard
The 07-15 publication that converts outreach activity into a measurable
outcome. Per [ADR-0007](docs/adr/0007-launch-outreach-scorecard.md):
`launch failed | launch viable | launch succeeded`. Triggers the
kill-rule decision on 07-31 if `failed`. **Verdict (2026-08-03): "launch
failed, regroup"** — zero outreach sends. New demand-validation sprint:
2026-08-03 → 2026-09-15.

## Pre-evidence sub-window
The sub-window 2026-05-27 → 2026-05-31 23:59 UTC, before evidence
collection begins for the verdict-authoritative dataset. Informational
only per [ADR-0005](docs/adr/0005-early-evidence-rollout.md). Per
[ADR-0017](docs/adr/0017-pre-evidence-threshold-exercise.md),
threshold-exercise runs for issue #101 are permitted in this window
only.

## Threshold exercise
A short (≤120s) deliberate tightening of an asset's `drift_bps` or
`depeg_bps` threshold to deterministically force a state transition,
exercising the evidence INSERT path or the on-chain commit path.
Allowed only in the pre-evidence sub-window per
[ADR-0017](docs/adr/0017-pre-evidence-threshold-exercise.md). Distinct
from a methodology bump (no methodology version change) and from a
production threshold change (no rule-revision intent). Logged in
`docs/operations/issue-101-exercise-log.md`.

## Technical Preview
The product status as of 2026-08-04. Engineering is complete
(methodology 0.7.0, 68 assets, byte-exact receipts, SDKs published)
but Commercial GA is NOT yet declared: Gates 2 (legal) and 4 (demand)
remain BLOCKED. The founder authorized public announcement as "V1
Technical Preview" (see `docs/decisions/2026-08-04-founder-ga-verdict.md`).

## Loop Intelligence (Sub-C)
Cross-protocol leverage cascade simulator ("Chaos Labs for Solana",
ADR-0036 variant A). `protocol-indexer-ts` polls Kamino + Jupiter Lend
for **anonymous, aggregate** leverage/health-factor data. Never persists
per-wallet data — **k-anonymity k≥5** enforced. Deployed to prod: 31 assets,
$837M tracked collateral, 2 protocols. Exposes `GET /v1/assets/{symbol}/loop-exposure`
+ `simulate_depeg?shock_bps=`. **Advisory only — walled off from the verifiable receipt.**

## k-anonymity (ADR-0036)
The privacy invariant for Loop Intelligence: no aggregate bucket is
published unless it contains at least 5 independent positions. A
grep-guard (`test/adr-0036-guard.test.ts`) bans `.owner`/`.authority`/
`*ByWallet*` patterns in `src/sources/*.ts` to enforce that per-wallet
data is never read or persisted.

## ORACLE_DEGRADED (ADR-0035)
An advisory "amber" oracle-trust layer — a frontend-only badge surfacing
when the independent Pyth oracle leg diverges from the market price
(>75bps), has wide confidence (≥100bps), or is stale (>90s).
**Out-of-hash** — zero methodology/engine/receipt impact.

## INTRINSIC_DEGRADED (ADR-0037)
An advisory "amber" backing-liveness badge — surfacing when an asset's
intrinsic value source may be frozen (stale directory flags, epoch lag).
Frontend-only, **out-of-hash** (ships via Vercel web deploy, zero
backend risk).

## Pyth confidence-gate (ADR-0032)
Methodology 0.7.0 feature: when the Pyth oracle's confidence interval
relative to its price exceeds 500bps (5%), the verdict is forced to
UNKNOWN (conservative — "missing data ≠ confirming data"). Calibrated
near-inert against prod (only JLP/USD.RR trips it).

## Intrinsic-liveness gate (ADR-0038)
A force-UNKNOWN gate for when an asset's backing source is frozen.
**Ships DISABLED-default** (env `INTRINSIC_LIVENESS_GATE`) — provably inert
+ byte-exact when disabled (the `intrinsic_stale` field is `skip_serialize_if`-omitted
from the JCS hash). To enable: calibrate vs prod → set the env (no new code deploy).

## Depth-gate (ADR-0034)
Thin-liquidity caps confidence to "medium" (never final_state).
**Ships DISABLED-default** (`DEPTH_GATE_FLOOR_USD=0`) — inert until the
founder runs the GO/NO-GO SQL + sets the env. Phase 1 of ADR-0026's
observe-first depth strategy.

## Holder-signed spread
The sign convention for all user-facing surfaces: premium (market >
intrinsic) is `+`, discount (market < intrinsic) is `−`. The internal
API field `discount` is premium-NEGATIVE (`1 − market/intrinsic`), so
the edge formatters negate it via `holderSignedPct()` (`web/lib/api/format.ts`).
The sign can no longer drift per-call-site (ADR-0042/0043 era fix).

Since 2026-08-10 the **color follows that same holder sign**: premium green
(`st-pegged`), discount red (`st-depeg-text`), zero neutral — on every surface,
including the share cards and OG images. It replaced a state-keyed scheme where
PEGGED was deliberately neutral, which had drifted into rendering the *same*
number neutral on the app page and green on the share card. Sign and color are
derived from one raw input by one helper (`spreadSignClass`) so they cannot
disagree; a guard test pins that.

Three consequences worth stating, because each one was contested and settled by
looking at the rendered product:

- **No exceptions.** Two carve-outs were proposed (an outlier highlighted by
  magnitude on `/compare`, a diagram label sharing its connector's state color)
  and both were retired: each made the *same* number two different colors on two
  pages, which is worse than whatever local nicety it bought.
- **A number next to something that carries identity still takes its sign.** The
  state word, the chart series swatch, the diagram connector keep their own
  color; the number beside them does not inherit it.
- **An unsigned magnitude stays neutral.** A median of absolute spreads, or a
  leveraged token's `2.31% above NAV`, prints no sign and therefore asserts no
  direction. Values bound to the state that carry no sign of their own — a
  verdict *sentence*, a 0-100 risk score — keep the state ramp via
  `severityTextClass`. (The spread number *inside* that sentence is still a
  signed number, and is colored as one.)

## Peg-risk score (`risk_score`)
A derived 0-100 number where **higher is worse**. Anchored to the committed
FSM state, so it can never contradict the classification: PEGGED owns 0-24,
DRIFT 25-49, DEPEG 50-74, CRITICAL 75-94, BLACK_SWAN 95-100, interpolated
within the band by the effective discount. `null` (never a fabricated number)
when the state is UNKNOWN, no discount exists, or thresholds are the CDP
collateral-ratio form. A presentation projection, NOT a receipt input.

## Market depth (`market_depth`)
A derived 0-100 number where **higher is better**. Answers one question only:
*is the quoted price executable?* Computed from measured liquidity, 24h volume
and holder count (migration 0075, sourced from tokens.xyz). `score: null` with
an `insufficient_reason` rather than a guess when the inputs are too sparse.

Three things it is NOT:
- **Not a peg score.** An asset can be perfectly pegged and completely
  illiquid. That combination is the normal state of most of the thin tail.
- **Not the [Depth-gate](#depth-gate-adr-0034).** They read the same underlying
  liquidity but do opposite things: the depth-gate is an ENGINE mechanism that
  caps *confidence* and can change a verdict (and ships disabled); market depth
  is inert presentation that never touches discount, state or thresholds.
- **Not the same polarity as `risk_score`.** Both are 0-100 and both appear on
  the same `/v1/assets` row. `risk_score: 100` is the worst possible reading;
  `market_depth.score: 100` is the best. Read the field name, not the number.

## Safety grade
The A/B/C/D letter on the asset page, a composite of three dimensions: peg,
liquidity, mechanism. Only **liquidity** is measured (it reads `market_depth`);
peg and mechanism remain class-based heuristics. The header label says which
regime produced the number, and the liquidity rationale names the binding
constraint when one fired. When `market_depth` is absent or older than 6 hours
it degrades to the pre-0075 symbol heuristic and says so.

## Frozen backing
An LST whose stake pool has stopped advancing its exchange rate. The danger is
that it reads as a *confident peg*: the rate is still served, so intrinsic looks
healthy and the verdict comes out PEGGED at high confidence. The 2026-04-01 dSOL
failure mode and the 2026-08-10 sharkSOL case.

Pegana has **two** mechanisms for this and neither caught sharkSOL, for the same
reason: [INTRINSIC_DEGRADED](#intrinsic_degraded-adr-0037) is an advisory badge
only, and the [Intrinsic-liveness gate](#intrinsic-liveness-gate-adr-0038) that
would force UNKNOWN **ships disabled by default**. What caught it instead was
`lst_directory_audit`'s third-party `stale` flag plus a manual on-chain read.
Enabling ADR-0038 after calibration is the standing fix; until then, detection
is a tripwire plus a human, not a gate.

**How to demonstrate it, and how not to.** A flat `meta.sol_per_lst` proves
nothing: the median distinct value across every Sanctum LST over 30 days is 1
(JupSOL held one value from 05-27 to 08-10), because Sanctum keeps serving the
last value a frozen pool computed. The discriminating evidence is on-chain — the
SPL stake pool's `last_update_epoch` lag against the current network epoch, plus
its total lamports. At epoch 1014 sharkSOL read 1002 (12 behind) holding 1.88
SOL, while bSOL and laineSOL both read 1014.

---

## Anti-glossary (terms NOT to use)

- ~~"plausible threshold range"~~ — replaced by ADR-0002's per-asset
  decision rules.
- ~~"alert_evidence retry"~~ as undefined prose — replaced by
  ADR-0006's pending table + 202/410 contract.
- ~~"trust me bro" verdict~~ — replaced by ADR-0001 mechanical rule.
- ~~"pre-V5 surface"~~ — the app console runs on the same V5
  tokens/fonts/components as marketing since the 2026-07-10/11 W3a-c+W4
  migration. There is NO pre-V5 surface.

---

## Cross-refs

- All 44 ADRs: `docs/adr/0001-0044-*.md`
- Trust Layer spec: `docs/pegana-trust-layer-v0.1.0/`
- Amendments index: `docs/pegana-trust-layer-v0.1.0/AMENDMENTS.md`
- Canonical changelog: `docs-site/changelog.mdx`
- Architecture map: `docs/ARCHITECTURE.md`
- Design system: `DESIGN.md` (supersedes `brand.md`)
- Commercial GA evidence: `docs/launch/commercial-ga/evidence-ledger.md`
- Founder GA verdict: `docs/decisions/2026-08-04-founder-ga-verdict.md`
