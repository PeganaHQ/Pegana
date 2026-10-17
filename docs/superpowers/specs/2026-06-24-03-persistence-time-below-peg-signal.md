# Spec 03 — Persistence / time-below-peg signal

**Wave 2 · engine + surfaces · migration 0057 · ADR-0027 · NO methodology version bump
(Option A).** Closes the one confirmed product blind spot — and it's the demand wedge
(the sUSD/Hylo mechanism-depeg story).

## Problem / context

Pegana classifies on the **instantaneous** smoothed discount via the FSM
(PEGGED→DRIFT→DEPEG→CRITICAL→BLACK_SWAN) with hysteresis. It cannot distinguish a 5-minute
blip from a slow mechanism depeg sitting ~2% below peg for **months** (the real sUSD /
Hylo case). There is no duration concept anywhere: `candidate_since`
(`state.rs`) tracks an *unconfirmed pending* transition (sub-2-min) and is wiped the
instant a candidate commits — it cannot answer "how long has this asset been in DRIFT".

## The ADR-0024 trap = the central design constraint

ADR-0024 proved a discount-**constancy** detector cannot work: healthy illiquid assets
sit at a constant small discount for hours (ONyc ~20h, vSOL 6.5h, hyloSOL+ 12.5h, even
USDC 67min) — indistinguishable from "frozen" by any constancy threshold. **A constant or
nonzero discount does NOT mean broken.**

The persistence signal is safe ONLY because it keys on **sustained residence in a
committed ALERTING band (DRIFT/DEPEG/CRITICAL/BLACK_SWAN)** — i.e. the FSM has *already
crossed a real threshold*. A months-long committed DRIFT (sUSD) is categorically
different from ONyc sitting flat *inside PEGGED*. The band crossing is exactly what the
freeze detector lacked. **Never key on constancy, nonzero discount, or time-below-a-trivial-bound.**

## Goals / non-goals

- **Goal:** surface, per asset, how long it has resided in its current committed state, and
  a derived `sustained` boolean (in an alerting band ≥ N) — as **enrichment**, closing the
  blind spot and powering the "in DRIFT for 3 months" narrative.
- **Non-goal (Option C, rejected for now):** letting duration *drive/escalate* published
  state. That changes `final_state` for some inputs → MINOR methodology bump + receipt
  hash change + `rederive` extension + the ADR-0009 7-day announce — and re-imports
  ADR-0024 risk if the threshold is loose. Ship Option A, observe, revisit only if a
  design partner needs escalation (a demand question, not a code one).

## Design — Option A (enrichment only), decided

Add `band_since: Option<DateTime<Utc>>` to `AssetRuntime` (`crates/engine-rs/src/state.rs`,
the struct at ~`:41-78`). Set/reset it inside/after `transition()` **only when the
committed `last_state` actually changes** (not on candidate staging). Persist it on
`engine_state_snapshot` so it survives restart — without persistence, every deploy resets a
months-long DRIFT to "0h / fresh", silently defeating the feature AND laundering missing
data (ADR-0019 violation).

Derive and surface:
- `current_state_duration_secs` = `now − band_since`
- `sustained` = `current_state ∈ {DRIFT,DEPEG,CRITICAL,BLACK_SWAN}` AND `duration ≥ N(band)`

**Why PEGGED-band assets are structurally safe:** they never leave PEGGED → `band_since`
anchors a PEGGED entry → `sustained` is definitionally false regardless of how flat/illiquid
they are. ONyc/vSOL/hyloSOL+ can never be "sustained-below-peg". The ADR-0024 trap is
avoided by construction, not by a tuned threshold.

**Reset rules (critical):**
- Reset `band_since` on EVERY committed transition (PEGGED→DRIFT, DRIFT→DEPEG, DRIFT→PEGGED, →UNKNOWN). Duration = "time in *current* committed state".
- `force_unknown` (`state.rs:537-543`) and the NAV-sanity override (`main.rs:781-797`) must reset `band_since` (UNKNOWN is a band change).
- A skipped tick (None discount / stale, the H8 path) must leave `band_since` untouched.
- A candidate staging (no committed change) must NOT reset it.

**Threshold N:** a tunable engine constant (like `CR_DEADBAND_PCT`, NOT a
methodology-versioned threshold), **per-band**: DRIFT default **6h** (longer than every
routine intra-day band excursion in calibration data, short enough to flag a mechanism
depeg within a day); DEPEG/CRITICAL much shorter (their mere persistence is already
alarming). Decided: per-band constants.

**Semantics decided:** "time in current committed state" (a DRIFT→PEGGED→DRIFT round-trip
resets). This matches a sustained mechanism depeg (which doesn't recover) and is the honest,
cheap-to-store definition (one timestamp, not an accumulator). Document it so consumers
don't read it as cumulative.

## Methodology / receipt impact — NONE (Option A)

`band_since`/duration are engine runtime + enrichment, NOT methodology-function
inputs/outputs — exactly how `liquidity_usd` was added as server-only metadata
(`state.rs:72-77`, "NOT part of the discount computation or the receipt hash"). Receipt hash
unchanged; `pegana-replay` unaffected; **no version bump.** `engine_state_snapshot` is
internal cache, explicitly "not a replay input" (ADR-0010 / migration 0035).

## Surfaces to update

- **Engine:** `AssetRuntime` (+`band_since`), `transition`/`force_unknown` reset logic, `snapshot_to_pg`/`load_from_pg`/`snapshot_all_to_pg` (`state.rs:637-740`), `AlertEvent.extra` (`main.rs:976-995`, beside `cr`/`confidence`/`liquidity_usd`), `persist_discount` extra (`main.rs:1250`).
- **API:** `/v1/assets` `AssetCard` — new optional `current_state_duration_secs` + `sustained` (same pattern as the SQL-derived `worst_discount_24h`); `/v1/alerts` selects fixed columns (`alerts.rs:114-126`) → add an `extra` projection to surface duration there too. OpenAPI/`schema.rs` updated.
- **Webhook:** dispatcher payload (`dispatcher-rs/src/main.rs:560-565`) + `webhook_dispatch.rs::synthetic_payload`.
- **Bot:** `dispatcher-rs` `build_send_payload` (`:776`) — render "in DRIFT for 3 months" (the product wedge).
- **Web:** asset-detail + screener — a "time in state" / "sustained" badge (highest-leverage narrative surface).
- **Docs:** `/methodology` page + ADR-0027 (with the explicit "NOT the ADR-0024 freeze detector — keys on committed-band residence" justification).
- **Spec 06 (attestation) consumes `sustained`:** a `sustained` asset must NOT be in the non-event attestation's asserted-clear set (a months-long DRIFT is a real depeg, not "clear"). See Spec 06 "Cross-spec dependency". If Spec 03 ships after Spec 06, wire this exclusion when it lands.

## Schema / migrations

`migrations/0057_engine_state_band_since.sql`:
```sql
ALTER TABLE engine_state_snapshot ADD COLUMN band_since TIMESTAMPTZ; -- nullable
```
Update `snapshot_to_pg` INSERT/UPDATE + `load_from_pg` SELECT + the `SnapshotRow` tuple
(`state.rs:17-23, 639, 687-695`). NULL row (pre-migration / pre-first-transition) hydrates
to "duration unknown → not sustained" (ADR-0019-honest). No `discount_snapshots`/`assets`/
`alerts` DDL change (duration rides existing `extra` JSONB).

## Risks

1. **ADR-0024 false-positive (central) — mitigated structurally:** fires only when the FSM is in a committed alerting band; PEGGED-band assets can never be `sustained`. Do NOT define `sustained` against raw/nonzero/constant discount.
2. **Restart correctness:** must persist `band_since` + hydrate, else a months-long DRIFT reads "0h" after every deploy (silent feature defeat + ADR-0019 violation).
3. **Hysteresis interaction (ADR-0023):** reset on the *committed* transition (post-`transition_decide`), not on candidate staging, else flapping candidates keep resetting the clock. Deadband-extended residence is correctly counted (not a bug).
4. **Override/skip paths:** `force_unknown`/NAV-sanity reset `band_since`; staleness-skip leaves it untouched. Verify against the `try_recompute` H8 paths.
5. **Semantics drift:** duration is "current committed state", not cumulative-below-peg. Document explicitly.

## Test plan + acceptance criteria

- Unit (state.rs): `band_since` set on first DRIFT commit; unchanged across PEGGED-internal recomputes; reset on DRIFT→DEPEG, DRIFT→PEGGED, →UNKNOWN; NOT reset on candidate-only staging; untouched on skipped tick; survives `snapshot_to_pg`→`load_from_pg`; NULL hydrates to not-sustained.
- **Proptest (the ADR-0024 regression guard):** for ANY asset whose committed state is PEGGED or UNKNOWN, `sustained == false` regardless of discount magnitude, constancy run-length, or elapsed time.
- Integration: a 90-day single-commit DRIFT → duration accrues monotonically, `sustained` flips at N, no spurious state change; a 5-min DRIFT blip that decays → never `sustained`.
- **Replay (critical):** receipt hash byte-identical to pre-change for the same inputs (golden-hash test proving the enrichment is outside the canonicalized struct); `cargo test -p pegana-methodology` + `pegana-replay` on an existing fixture PASS unchanged.
- **Acceptance:** ONyc/vSOL/hyloSOL+-class never `sustained=true`; a months-long ~2% committed DRIFT reports multi-month duration + `sustained=true`; receipt hash + all replay fixtures unchanged; restart mid-DRIFT preserves elapsed duration; no methodology version bump.

## Decided open questions

- Semantics: "time in current committed state" (recovery resets) — DECIDED.
- Per-band N (DRIFT 6h; DEPEG/CRITICAL shorter) — DECIDED, tunable constants.
- Surface on `/v1/alerts`: yes, via an `extra` projection — DECIDED.
- Boot with non-PEGGED `last_state` + NULL `band_since`: leave NULL → not-sustained until next genuine transition (honest) — DECIDED.
- Option C (escalation) deferred until a design partner needs it — DECIDED.

## Grill outcomes

- *"How is this not the rejected ADR-0024 freeze detector?"* — The freeze detector keyed on discount *constancy* across ALL assets including PEGGED ones (false-positived JupSOL). This keys on *committed alerting-band residence*; PEGGED/illiquid-flat assets are structurally excluded. The proptest enforces it.
- *"Why enrichment, not escalation?"* — Escalation (Option C) is a methodology change (MINOR bump, replay, 7-day cadence) and a demand question; per the standing verdict (demand is the gap) we don't pay that cost until a partner needs duration to *drive* state. Enrichment closes the blind spot now at zero methodology risk.
- *"Does duration belong in the receipt?"* — No. Keeping it out preserves byte-exact replay of all history. The golden-hash test is the guardrail.
