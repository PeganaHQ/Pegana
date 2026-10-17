# Spec 06 — Verifiability artifacts (non-event attestation + incident report page)

**Wave 2 · engine + api + web · migration 0058 · ADR-0029 · no methodology bump (additive
infra).** Strengthens the trust layer's two coverage gaps: proving the *absence* of depegs,
and turning each real depeg into a shareable, verifiable artifact.

## Shared context — all trust machinery already exists and is reusable

- Receipt struct + NO-FLOATS invariant: `methodology/src/receipt.rs:16-26,59`.
- Canonical hash `canonical_receipt_hash()` (`canonical.rs:31`): `sha256(version‖0x00‖git_sha‖0x00‖assets_canonical‖0x00‖JCS(inputs)‖0x00‖JCS(computed))`, RFC 8785 JCS.
- Re-derive `rederive()` (`rederive.rs:99`); public CLI `pegana-replay-cli` (`verify`/`verify_onchain`, signer pin `PEGANA_COMMIT_SIGNERS` `:46`).
- On-chain commit `onchain_commit.rs`: SPL Memo `"pegana-v1|<version>|<alert_id>|<receipt_sha256>"`, retry/dead-letter/semaphore, signer `7Ppoyum…u7R9`.
- In-browser verifier `web/lib/verify-receipt.ts` (JS port of `canonical.rs`, byte-exact).
- Audit/alerts APIs: `audit.rs` (`/v1/audit/:id`, `/replay-bundle`, `/onchain`), `alerts.rs`.
- Liveness scan `EngineState::classify_freshness(now, stale_after) → {fresh, stale, dead}` (`state.rs:584`) — read-only, per active asset.
- Offline receipt producer pattern: `xtask/src/backtest/runner.rs`.

## Artifact A — Signed non-event attestation (open P0)

### What it asserts
Periodically, the engine produces an **AttestationReceipt** for window `[t0,t1]`: "Across all
`active` assets with fresh data, the published peg-state was in the asserted-clear set for
the entire window, and the engine was live throughout." A **coverage + liveness** proof
distinct from per-transition alerts (today, silence is ambiguous: all-pegged vs engine-dead;
the existing Redis `heartbeat` is unsigned liveness telemetry, not a verifiable artifact).

### Design (decided)
1. New attestation tick alongside the H12b sweep (`main.rs:249-260`). `EngineState::attestation_snapshot(now)` (read-only, mirrors `classify_freshness`) gathers `(asset, last_published_state, last_recompute_at, fresh)` per active asset.
2. Build `AttestationInputs { window_start, window_end, methodology_version, methodology_git_sha, assets_toml_sha256, asserted_clear_states, coverage[], coverage_complete, prev_attestation_sha256 }` (NO-FLOATS). Canonicalize (JCS) + sha256 → `attestation_sha256` via a sibling `canonical_attestation_hash()`.
3. Persist to `non_event_attestation` (append-only).
4. **Hash-chain:** include `prev_attestation_sha256` so a gap in the sequence is detectable (a true coverage proof). DECIDED: yes.
5. **On-chain anchor:** reuse `onchain_commit.rs` with memo `"pegana-att-v1|<version>|<window_end>|<attestation_sha256>"`. **Anchor DAILY (roll-up), not hourly** — hourly attestations are hash-chained + API/RSS-published; a daily memo bounds SOL cost. DECIDED.

### Honesty rule (mandatory — ADR-0019)
An attestation must NOT assert "clear" if any active asset is `dead`/`stale` (per
`classify_freshness`) or sits in `UNKNOWN` (NAV-sanity force, ADR-0025). Those set
`coverage_complete=false` and are enumerated; the asserted statement becomes "all assets
with fresh data were clear; N had no fresh signal" — never a silent false all-clear. This is
the exact blind spot the memory warns about.

**Asserted-clear set decided:** `state ∉ {DEPEG, CRITICAL, BLACK_SWAN}` AND `state ≠ UNKNOWN`
AND `fresh` AND **NOT `sustained`** (the Spec 03 flag). A *transient* DRIFT counts as clear
(routine sub-alert), but a **sustained DRIFT is a mechanism depeg (Spec 03's whole point) and
must NOT be attested as clear** — otherwise a sUSD-style slow depeg sitting in DRIFT for
months would be silently certified "nothing depegged". UNKNOWN/dead/stale/`sustained` →
`coverage_complete=false`, asset enumerated.

> **Cross-spec dependency:** the `sustained` flag comes from Spec 03 (`band_since`). The
> attestation producer must tolerate its ABSENCE gracefully (if Spec 06 ships before Spec
> 03, fall back to "transient DRIFT = clear" and add the `sustained` exclusion when Spec 03
> lands). Treat a missing `sustained` as `false` but log it so the gap is visible.

### Published / verified
- API: `GET /v1/attestation/latest`, `/v1/attestation/:id` (immutable-cached), `/v1/attestation` (index, gated on `feature_public_alerts` like `/v1/audit` index; by-id ungated).
- CLI: extend `pegana-replay-cli` with `--attestation <id|bundle>` — re-hash via `canonical_attestation_hash`, and with `--verify-onchain` check the daily `pegana-att-v1` memo under the SAME signer pin.
- Schema: own `att-v1` namespace, SEPARATE from receipt `v1|v2` (so `verify()`'s `matches!(schema_version,"v1"|"v2")` guard `main.rs:155` is untouched and history keeps verifying).
- RSS/Atom: there is NO existing api-rs feed handler (the `/feed/events.xml` ref in `alerts.rs:98` is unimplemented server-side). **Defer feeds** to a follow-up; attestations are reachable via API + on-chain. DECIDED.

### Version impact
None — additive infra (no methodology behaviour change). Each attestation embeds the current
`0.4.0` + `assets_toml_sha256`, self-pinning; a future methodology bump naturally rolls the
attestation hash.

## Artifact B — Incident report page `/incident/[id]`

### Concept
A status-page-style postmortem per depeg episode, auto-generated from live alert data,
reusing the backtest page as the literal template. **Incident = contiguous episode for one
asset** (PEGGED→…≥DEPEG→…recovery). **Keying decided:** incident id = the `alert_id` of the
transition that first reached ≥DEPEG; collapse adjacent episodes separated by < **30 min**
(flap guard — the hyUSD CR-deadband flapping history is the cautionary case).

### Design (decided)
- Data: `/v1/alerts?asset=&since=` (transition chain) + `/v1/audit/:id/replay-bundle` (the exact `ReplayBundle` the in-browser verifier consumes) + `/v1/audit/:id/onchain` + `/v1/methodology/current`.
- Route `web/app/incident/[id]/page.tsx` (server component; **read `web/node_modules/next/dist/docs/` first** — Next 16). Fetches the chain + each transition's replay-bundle at request time (or ISR) via a new `web/lib/incident/incident-data.ts` (the live-API analogue of `backtest-data.ts`).
- Reuse: clone `web/app/backtest/2025-10-10-usde-depeg/page.tsx` body into a shared `web/app/backtest/_components/` or `web/components/`; **`static-receipt-verifier.tsx` reused as-is** (already takes a `ReplayBundle` + calls `verifyReceipt`); `BacktestChart`→generalized `IncidentChart`; `BandGauge`/`stateBadgeClass`/`discountToBps` reused.
- Index `web/app/incident/page.tsx` (clone `backtest/page.tsx`) listing recent incidents from `/v1/audit?state=DEPEG` etc.
- **Backend support (decided: yes, thin):** `GET /v1/incidents` + `/v1/incidents/:id` doing episode-grouping server-side (group `alerts` by asset into contiguous ≥DEPEG runs, collapse <30min) → `{id, asset, started_at, recovered_at, max_state, transition_alert_ids[]}`. Keeps grouping logic testable in Rust instead of duplicated in the web layer.
- Linking: add "Incident report" links from `/audit` rows + alert payloads where `to_state ∈ {DEPEG,CRITICAL,BLACK_SWAN}`.

## Files to touch (exact)

**Artifact A:** `methodology/src/canonical.rs` (+`canonical_attestation_hash`), `lib.rs:16`
(export), NEW `methodology/src/attestation.rs` (structs, NO-FLOATS); `engine-rs/src/state.rs`
(+`attestation_snapshot`), `main.rs:249-260` (tick + `persist_attestation` + optional
`commit_attestation`), `onchain_commit.rs` (new `pegana-att-v1` memo const near `:33`); NEW
`api-rs/src/routes/attestation.rs` + wire `main.rs:220` + `openapi.rs`; `pegana-replay-cli/src/main.rs`
(`--attestation` mode + `pegana-att-v1` parse); NEW `web/lib/verify-attestation.ts` (clone
`verify-receipt.ts`); NEW `migrations/0058_non_event_attestation.sql`.

**Artifact B:** NEW `web/app/incident/[id]/page.tsx`, `web/app/incident/page.tsx`,
`web/app/incident/[id]/incident-chart.tsx`, `web/lib/incident/incident-data.ts`; move
`static-receipt-verifier.tsx` to `web/components/` for sharing; add "Incident report" links
in `web/app/audit/…`; NEW `api-rs/src/routes/incidents.rs` + wire `main.rs` + `openapi.rs`
(+bump the OpenAPI path-count guard — coordinate with Spec 01's bump).

## Schema / migrations — `0058_non_event_attestation.sql`

Append-only (follow `0028_alert_evidence.sql` immutable-trigger pattern; `onchain_tx_sig`/
`commit_status` write-once like 0031):
```sql
CREATE TABLE non_event_attestation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start TIMESTAMPTZ NOT NULL, window_end TIMESTAMPTZ NOT NULL,
  methodology_version TEXT NOT NULL, methodology_git_sha TEXT,
  assets_toml_sha256 CHAR(64) NOT NULL, asserted_clear_states TEXT[] NOT NULL,
  coverage JSONB NOT NULL, coverage_complete BOOLEAN NOT NULL,
  prev_attestation_sha256 CHAR(64), attestation_sha256 CHAR(64) NOT NULL,
  onchain_tx_sig TEXT, commit_status TEXT NOT NULL DEFAULT 'not_applicable',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_attestation_window ON non_event_attestation (window_end DESC);
```
(Confirm `gen_random_uuid()`/pgcrypto is already used, else use an engine-generated UUID.)
Artifact B needs NO new table (derives from `alerts`+`alert_evidence`).

## Signing / receipt / version impact

JCS+sha256+`0x00` discipline identical to receipts; NO-FLOATS on `AttestationInputs`.
"Signed" = on-chain memo by the pinned ops wallet (same trust model; the signer pin IS the
signature authority — no new keypair). `att-v1` namespace keeps the receipt guard untouched.
No methodology bump.

## Risks

1. **False all-clear (highest):** gate on `classify_freshness`; `coverage_complete=false` on any dead/stale/forced-UNKNOWN.
2. **On-chain cost/quota:** daily roll-up + config gate (not hourly memos).
3. **JS/Rust hash divergence:** `verify-attestation.ts` must match `canonical_attestation_hash` byte-for-byte → cross-impl golden test.
4. **Episode-grouping ambiguity:** episode = contiguous ≥DEPEG run; collapse <30min (flap guard).
5. **Next 16 unknowns:** read `node_modules/next/dist/docs/` first.
6. **`feature_public_alerts` gating:** attestation index + incident index respect it (don't leak the ledger pre-launch).
7. **Append-only trigger:** `onchain_tx_sig` write-once needs the 0031 trigger-loosening dance.

## Test plan + acceptance

- A unit: `canonical_attestation_hash` determinism + changes-on-input; honesty (one dead asset → `coverage_complete=false`, enumerated, never clear); `attestation_snapshot` read-only + correct bucketing; API immutable-cache + index gating; CLI `--attestation` PASS/FAIL/`--verify-onchain` memo+signer; **cross-impl golden** (Rust `canonical_attestation_hash` == JS `verify-attestation.ts`). Acceptance: a published attestation is byte-exactly re-derivable by the public CLI AND the browser verifier; a dead asset can never produce a clear assertion.
- B web/vitest: `incident-data` groups a synthetic chain into one episode (flap-collapse honored); `static-receipt-verifier` reuse verifies a fetched bundle. Playwright: `/incident/<id>` → click "Verify this receipt" per transition → "Verified — hash matches". a11y: 0 axe violations at BOTH viewports. Acceptance: `/incident/[id]` renders timeline + per-transition in-browser verification (all PASS) + methodology pin + recovery, from live `/v1/alerts`+`/v1/audit`, linked from `/audit`.

## Decided open questions

- Cadence: hourly hash-chained + daily on-chain memo — DECIDED.
- Asserted-clear set: not-{DEPEG,CRITICAL,BLACK_SWAN} and not-UNKNOWN and fresh and NOT `sustained` (Spec 03); transient DRIFT=clear, sustained DRIFT≠clear — DECIDED (resolves the Spec 03↔06 contradiction).
- Hash-chaining: yes (`prev_attestation_sha256`) — DECIDED.
- Incident keying: first ≥DEPEG `alert_id`, flap-collapse <30min — DECIDED.
- Backend incidents endpoint: yes (server-side grouping) — DECIDED.
- RSS/feeds: deferred — DECIDED.
- ADR-0029 records the scheme + memo + honesty rule — DECIDED.

## Grill outcomes

- *"Is a non-event attestation real value or theater?"* — it converts ambiguous silence into a signed, hash-chained, on-chain-anchored coverage+liveness proof, closing ADR-0015's "no liveness fallback" weakness. The honesty rule is what makes it not-theater (it refuses to assert clear over dead data).
- *"Why clone the backtest page for incidents?"* — the backtest page already solves the hard part (timeline + in-browser byte-exact receipt verification); incidents are the same artifact fed from live alert data instead of a static fixture. Reuse, don't reinvent.
- *"DRIFT clear or incident?"* — DRIFT is routine (sub-alert, no public alert by design); treating it as an incident would spam false postmortems. Incident = ≥DEPEG.
