# Pegana improvement specs — overview, sequencing & cross-spec allocations (2026-06-24)

This is the index for a 7-spec batch produced from a full brainstorm + per-track codebase
validation (7 read-only validation agents, 2026-06-24). Each spec is Codex-ready
(exact file/line refs, decided open questions, test plan, acceptance criteria). The
specs were stress-tested with `/grill-with-docs` (against the ADRs/CONTEXT.md) and
`/grill-me` — see §"Grill outcomes" at the end of each spec.

> **Stability lock note:** the 2026-06-25 methodology stability lock is treated as
> LIFTED per founder instruction (it self-expires 06-25 anyway). Specs still record
> each methodology-version implication so the ADR-0009 cadence (announce + passive
> dual-run) is a *conscious* call, not an accident.

## The 7 specs (by file)

| # | Spec | Wave | Methodology bump? | Surface |
|---|---|---|---|---|
| 01 | tokens.xyz signal-out feed | 1 | No | api-rs |
| 02 | Embeddable peg-risk badge (verify + harden) | 1 | No | web |
| 03 | Persistence / time-below-peg signal | 2 | **No** (Option A, enrichment-only) | engine + surfaces |
| 04 | Print-quality gates (depth + Pyth conf) | 1 (P0) / 3 (P1) | P0 No · P1 Yes | indexer + engine |
| 05 | Trust-minimized intrinsics (direct stake-pool reads) | 2 | No (source change, not formula) | indexer |
| 06 | Verifiability artifacts (non-event attestation + incident page) | 2 | No (additive infra) | engine + api + web |
| 07 | Backtest expansion | 1 (code) / 3 (events) | No (methodology stays 0.4.0) | xtask + web + CI |

## Headline validation findings (these reshaped the specs)

1. **Spec 01 — the contract already exists.** `docs/strategy/2026-06-22-tokens-xyz-sample-LIVE.json` + `tokens-xyz-peg-include-LIVE.json` are Rafael-validated target shapes; `/v1/assets/by-mint/:mint` mint-keying already ships. → thin no-migration transform.
2. **Spec 02 — already built (Wave 11M).** Routes/CORS/CSP-scoping exist. Real work = verify under the now-ENFORCED CSP + make "verifiable" literally true (the verify link doesn't reach a receipt; `audit/page.tsx` ignores `?asset=`). Reframed build→harden.
3. **Spec 03 — no methodology bump.** Option A (`band_since` → duration + `sustained` flag, keyed strictly on *committed alerting-band residence*) closes the confirmed blind spot with ZERO receipt/replay risk and structurally sidesteps the ADR-0024 freeze-detector trap (PEGGED-band assets can never be "sustained"). Lower-risk than the brainstorm implied.
4. **Spec 04 — Gate B already exists.** `pyth_confidence_label` already buckets on conf/price WIDTH and `pyth_entry` already staleness-gates. Gate B = confirm + test, not new logic. Gate A (depth) keeps ADR-0026's observe-first two phases.
5. **Spec 05 — mSOL & INF are NOT SPL stake-pools** (Marinade proprietary; INF = Sanctum Infinity S-controller) → stay on Sanctum. Engine `set_intrinsic` is last-write-wins (no source dim) → "Sanctum as cross-check" must be an OUT-OF-BAND divergence task, not dual-write. Source string isn't a canonical receipt input → likely no version bump (confirm via `canonical.rs` proptest).
6. **Spec 06 — all trust machinery is reusable.** Attestation = new `att-v1` schema namespace (separate from receipt `v1|v2`); incident page = clone the backtest page fed from live API. Honesty rule (no false all-clear) is mandatory.
7. **Spec 07 — data availability is the real blocker**, not code. Templatize (capture.toml + Rust-emitted `receipts/all.json` + manifest.json + CI matrix); candidate events need a `--capture` dry-run before committing fixtures.

## Cross-spec ALLOCATIONS (authoritative — Codex must use these to avoid collisions)

Latest migration = `0055_perena_usd_star.sql`. Latest ADR = `0026-tokens-xyz-liquidity-depth-gate.md`.

**Migrations:**
- `0056_liquidity_observations.sql` — Spec 04 Phase 0
- `0057_engine_state_band_since.sql` — Spec 03 (`ALTER engine_state_snapshot ADD band_since`)
- `0058_non_event_attestation.sql` — Spec 06
- `0059_lst_direct_reads.sql` — Spec 05 (data-only `UPDATE assets`)
- Spec 04 Phase 1 + any methodology bump migration → allocated at ship time (≥0060), template `0051_methodology_v0_4_0.sql`.

**ADRs:**
- `0027-persistence-time-below-peg-signal.md` — Spec 03 (records the "NOT the ADR-0024 freeze detector" justification)
- `0028-lst-direct-stake-pool-reads.md` — Spec 05
- `0029-non-event-attestation.md` — Spec 06 (attestation scheme + memo format + honesty rule)
- Spec 04 → updates existing `0026` (flip Proposed→Accepted at Phase 1).
- Specs 01, 02, 07 → no ADR (not hard-to-reverse architectural decisions).

**On-chain memo schemes** (keep namespaces disjoint so the public CLI's `matches!(schema_version, "v1"|"v2")` guard and signer pin stay intact):
- existing alerts: `pegana-v1|<version>|<alert_id>|<receipt_sha256>`
- new attestation: `pegana-att-v1|<version>|<window_end>|<attestation_sha256>` (Spec 06)

## Recommended sequencing

**Wave 1 — ship now (low risk, no methodology bump, mostly parallelizable):**
- Spec 01 (feed) — rides the tokens.xyz inbound; highest distribution leverage.
- Spec 02 (badge harden) — small, closes the "verifiable" gap, passive distribution.
- Spec 04 Phase 0 (observe) — indexer-only; unblocks the depth-gate decision with data.
- Spec 07 templatization (code only; events gated on data dry-run).

**Wave 2 — engine/infra (no methodology *version* bump, but engine recreate + replay-diff):**
- Spec 03 (persistence, Option A) — closes the confirmed blind spot; the demand wedge.
- Spec 05 (stake-pool reads) — trust-minimization; ADR + replay-diff (no version bump).
- Spec 06 (attestation + incident) — additive trust infra.

**Wave 3 — contingent on observed data:**
- Spec 04 Phase 1 (depth gate) — needs ≥1 week of Phase-0 distribution; methodology bump.
- Spec 07 events — need a `--capture` dry-run to confirm Pyth Benchmarks minute-history.

## Cross-spec coordination hazards (Codex MUST respect — found in the consolidated grill)

These are emergent risks from the SET that no single spec sees:

1. **Migration numbers are pre-allocated (0056-0059 above) — do NOT auto-increment.** If specs ship out of order or in parallel worktrees, two could grab the same "next" number. Use the allocation; renumber only at merge if order changed, keeping filenames monotonic.
2. **`openapi.rs:479` path-count guard has TWO editors.** Spec 01 adds 2 routes (35→37); Spec 06 adds up to 5 (attestation 3 + incidents 2). Whoever ships second must set the count to the cumulative total, not re-apply 35→37. Treat `openapi.rs` as a single-owner merge point.
3. **Specs 03, 04-Phase1, and 06 all edit `engine-rs/src/main.rs` in overlapping regions** (the tick loop `~249-260`, `event.extra` `~976-995`, `force_unknown` `~781-797`). Do these **sequentially on one branch**, NOT in parallel worktrees — they will conflict.
4. **`force_unknown` ↔ `band_since` interaction (Spec 03 ↔ Spec 04-Phase1).** Spec 03 resets `band_since` on `force_unknown`; Spec 04-Phase1 uses `force_unknown` for the depth gate. So a transient liquidity-gap UNKNOWN would reset a sustained-DRIFT duration. This is honest (UNKNOWN = "we don't know") but means a flapping depth feed could mask a sustained depeg. Acceptable, but document it where both meet; if it bites, gate `band_since` reset to only *genuine* state changes, not depth-gate UNKNOWNs.
5. **Spec 03 `sustained` ↔ Spec 06 attestation-clear contradiction — RESOLVED:** a `sustained` asset is excluded from the asserted-clear set (a months-long DRIFT is a real depeg, not "clear"). See Spec 06 + Spec 03 cross-refs. The attestation must tolerate `sustained` being absent if it ships first.

## Global guardrails (apply to every spec)

- **Methodology 0.4.0 stays the verifiable target** unless a spec explicitly bumps it; all existing receipts + the released public CLI must keep re-deriving.
- **ADR-0019 invariant:** missing data ≠ confirming data. No new signal may launder absence into "healthy/clear" (hits Specs 03, 04, 06 hardest).
- **ADR-0024 trap:** constancy/illiquidity ≠ broken. Anything time-based (Spec 03) keys on *committed band crossing*, never on raw/constant discount.
- **Indexer-only recreate** for indexer changes (Specs 04 P0, 05); engine recreate is a separate, deliberate step (Specs 03, 04 P1, 06).
- **Demand discipline:** this whole batch is hardening/distribution. Per the standing strategic verdict (demand is the gap), Wave-1 distribution items (01, 02) and the demand-wedge (03) outrank pure hardening. Do not let the engineering crowd out demand work.
