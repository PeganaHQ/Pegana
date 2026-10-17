# Trilha A — Trust-core / Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Pegana core legible and honest — every non-nominal state carries a machine-readable reason, contradictory endpoints agree, the signed discount is self-describing, the "verify" claim is honestly labelled, and docs stop contradicting the code — with **zero receipt-hash impact**.

**Architecture:** All changes are additive (new optional fields / new nullable column / doc edits). The `state_reason` rides as a **top-level `Receipt` field outside the canonical hash** (sibling of `schema_version`) plus a nullable `discount_snapshots` column the engine writes and the API reads. No methodology-version bump; historical 0.4.0 receipts must re-hash and re-derive byte-identically after every task.

**Tech Stack:** Rust (axum API, engine, `rust_decimal`, `sqlx`), TimescaleDB migrations, TypeScript/Next.js (web verifier), Markdown docs.

**Parent spec:** `docs/superpowers/specs/2026-06-29-audit-remediation-campaign-design.md` (§3 Sprint A).

**Implementer:** Sonnet 4.6 (all tasks) · **Reviewer/orchestrator:** Opus 4.8.

**Per-task gate (the "padrão forte"):** after each task — `/code-review` (effort high) + `/review-and-iterate` + `cargo test`/`vitest` green. **Trilha A asserts no hash change**: the CLI re-derive of an existing committed v2 receipt must still PASS unchanged (Task 0 baseline).

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `crates/methodology/src/receipt.rs` | `Receipt` struct — add `state_reason` (out-of-hash) | 1 |
| `crates/methodology/src/canonical.rs` (tests) | prove `state_reason` does NOT enter the hash | 1 |
| `migrations/00NN_state_reason.sql` | nullable `state_reason` column on `discount_snapshots` | 2 |
| `crates/engine-rs/src/main.rs` | compute + emit `state_reason` into snapshot + receipt | 2 |
| `crates/api-rs/src/routes/assets.rs` | surface `state_reason` + `risk_side` on `AssetCard`/`StateResp`; align EURC freshness | 2, 3, 4 |
| `crates/indexer-rs/src/sources/hylo.rs:88` | honour `hylo_onchain_poll_ms` toml field | 5 |
| `crates/pegana-replay-cli/src/main.rs:223-231` | v1 PASS line says "tamper-evident only" | 6 |
| `web/lib/verify-receipt.ts`, `web/app/backtest/2025-10-10-usde-depeg/static-receipt-verifier.tsx` | relabel "Verify integrity (hash)" + roadmap note | 7 |
| `assets.toml:1` (repo root) | honest header (65 entries/~64 active) | 8 |
| `METHODOLOGY.md` | bring v0.2.0 → 0.4.0 | 9 |
| `README.md`, `docs/spec.html`, `docs/.../04-data-model.md` | one hosting SKU | 10 |
| `web/app/backtest/page.tsx` + sibling | "in this replay" denominator | 11 |

---

## Task 0: Hash-invariance baseline (safety net for the whole sprint)

**Files:**
- Test: `crates/pegana-replay-cli/` (use an existing committed v2 receipt fixture)

**Resolved fixture (v2):** `docs/backtests/2025-10-10-usde-depeg/receipts/USDe-004.json` — `expected_receipt_sha256 = 31c06db4fc9acc6606bf2f93d53482ffc1e31c6ade7d8a89e5411fe40461bd03`. CLI bin name = `pegana-replay`.

- [ ] **Step 1: Capture the current PASS output of the known v2 receipt**

```bash
cargo run -q -p pegana-replay-cli --bin pegana-replay -- --bundle docs/backtests/2025-10-10-usde-depeg/receipts/USDe-004.json > /tmp/trilha_a_baseline.txt 2>&1
cat /tmp/trilha_a_baseline.txt
```
Expected (CONFIRMED baseline 2026-06-30):
```
PASS  USDe  Critical -> Depeg  @ 2025-10-10 21:38:00 UTC (re-derived)
      methodology v0.4.0, assets_toml sha256:998bc4960b66
      recomputed receipt:31c06db4fc9a matches stored receipt:31c06db4fc9a
```

- [ ] **Step 2: Confirm the baseline hash**

```bash
grep -o '"expected_receipt_sha256": *"[a-f0-9]*"' docs/backtests/2025-10-10-usde-depeg/receipts/USDe-004.json
# must read 31c06db4fc9acc6606bf2f93d53482ffc1e31c6ade7d8a89e5411fe40461bd03
```
**Re-run Step 1 after every task in this sprint; the PASS line and this hash MUST be byte-identical.** Any change = a task broke hash-invariance → stop and fix.

- [ ] **Step 3: Commit nothing (baseline only).** Note the baseline hash in the sprint branch description.

---

## Task 1: `state_reason` on the Receipt (out-of-hash, additive)

**Files:**
- Modify: `crates/methodology/src/receipt.rs:59-68`
- Test: `crates/methodology/src/canonical.rs` (tests module)

- [ ] **Step 1: Write the failing test — `state_reason` does NOT change the hash**

In `crates/methodology/src/canonical.rs` tests module, add:
```rust
#[test]
fn state_reason_is_outside_the_hash() {
    use crate::receipt::{Receipt, InputsFrozen, Computed};
    // Build any valid receipt via the existing test helper (mirror an existing
    // canonical.rs test's construction of InputsFrozen/Computed).
    let base = sample_receipt(); // existing helper or inline construction
    let mut with_reason = base.clone();
    with_reason.state_reason = Some("premium_sanity".to_string());
    assert_eq!(
        canonical_receipt_hash(
            &base.methodology_version, base.methodology_git_sha.as_deref(),
            &base.assets_toml_canonical, &base.inputs_frozen, &base.expected_computed,
        ).unwrap(),
        canonical_receipt_hash(
            &with_reason.methodology_version, with_reason.methodology_git_sha.as_deref(),
            &with_reason.assets_toml_canonical, &with_reason.inputs_frozen, &with_reason.expected_computed,
        ).unwrap(),
        "state_reason must NOT enter the canonical receipt hash"
    );
}
```

- [ ] **Step 2: Run it — expect a COMPILE error (`state_reason` field missing)**

Run: `cargo test -p pegana-methodology state_reason_is_outside_the_hash`
Expected: FAIL — `no field state_reason on type Receipt`.

- [ ] **Step 3: Add the field to `Receipt` (out of hash)**

In `crates/methodology/src/receipt.rs`, add to the `Receipt` struct (after `expected_receipt_sha256`):
```rust
    /// Advisory, machine-readable reason for the current state — explains the
    /// "why" behind UNKNOWN / a premium / a skip. NOT part of the canonical
    /// hash (sibling of `schema_version`): old 0.4.0 receipts re-hash/re-derive
    /// identically, and this field is therefore tamper-EVIDENT only via the
    /// surrounding transport, not via the receipt hash. One of:
    /// `premium_sanity | stale_source | no_oracle_crosscheck |
    /// intrinsic_unavailable | shallow_market | nominal`. `None` on legacy
    /// receipts (serde default).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_reason: Option<String>,
```
`canonical_receipt_hash` already takes 5 explicit args and never reads the full `Receipt`, so no hashing code changes.

- [ ] **Step 4: Run the new test + the full methodology suite**

Run: `cargo test -p pegana-methodology`
Expected: PASS, including `state_reason_is_outside_the_hash` and all existing canonical/rederive tests.

- [ ] **Step 5: Re-run the Task 0 baseline (hash-invariance gate)**

Run: `cargo run -p pegana-replay-cli -- verify <v2-fixture>.json` → diff against `/tmp/trilha_a_baseline.txt`.
Expected: byte-identical (the fixture has no `state_reason`, deserializes via `#[serde(default)]` to `None`).

- [ ] **Step 6: Commit**

```bash
git add crates/methodology/src/receipt.rs crates/methodology/src/canonical.rs
git commit -m "feat(methodology): add advisory state_reason to Receipt (out-of-hash)"
```

---

## Task 2: Engine emits `state_reason` → snapshot column → API surface

**Files:**
- Create: `migrations/0058_state_reason.sql` (next free number; confirm with `ls migrations/ | tail`)
- Modify: `crates/engine-rs/src/main.rs:942-950` (receipt build) + the snapshot-insert + the state-resolution site
- Modify: `crates/api-rs/src/routes/assets.rs:69` (AssetCard), `:287-296` (ASSETS_LIST_SQL), `:700-716` (StateResp), `:770-795` (state_for_symbol SQL)
- Test: `crates/api-rs/tests/` (extend an existing assets integration test)

- [ ] **Step 1: Write the migration (additive, nullable)**

`migrations/0058_state_reason.sql`:
```sql
-- state_reason: advisory machine-readable reason for the snapshot's state.
-- Nullable + additive; no backfill (legacy rows stay NULL = unknown reason).
ALTER TABLE discount_snapshots ADD COLUMN IF NOT EXISTS state_reason text;
```

- [ ] **Step 2: Add a `state_reason` helper in the engine**

In `crates/engine-rs/src/main.rs`, near the state-resolution code, add a pure helper that maps the already-known branch to a reason string. Reuse the existing branch conditions (NAV-sanity force_unknown at ~:781, intrinsic-unavailable skip, no-Pyth-crosscheck cap). Example shape (wire to the REAL local variables at the call site):
```rust
fn resolve_state_reason(
    forced_unknown_by_nav_sanity: bool,
    intrinsic_missing: bool,
    no_oracle_crosscheck: bool,
    final_state: PegState,
) -> Option<String> {
    if forced_unknown_by_nav_sanity { return Some("premium_sanity".into()); }
    if intrinsic_missing { return Some("intrinsic_unavailable".into()); }
    if no_oracle_crosscheck { return Some("no_oracle_crosscheck".into()); }
    match final_state {
        PegState::Pegged => Some("nominal".into()),
        _ => None,
    }
}
```
(Do NOT invent new gates — only label branches that already exist. `shallow_market` is intentionally NOT emitted here; it arrives in Trilha B with the depth gate.)

- [ ] **Step 3: Thread the reason into the snapshot INSERT and the Receipt**

At the receipt build (`main.rs:942`), add `state_reason: reason.clone(),` to the `Receipt { … }`. At the `discount_snapshots` INSERT, add the `state_reason` column + bind `reason`.

- [ ] **Step 4: Surface it on the API — add field + SQL**

`assets.rs` AssetCard (after `:69 pub state`):
```rust
    /// Advisory reason for the current state (see Receipt.state_reason).
    /// Omitted when null. NOT a verdict input — explanatory only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_reason: Option<String>,
```
`ASSETS_LIST_SQL` (`:291` area): add `d.state_reason AS state_reason,`. `fetch_card` row mapping (`:262` area): `state_reason: r.try_get("state_reason").ok(),`. Same for `StateResp` (`:700`) + `state_for_symbol` SQL (`:786`): add `c.state_reason`.

- [ ] **Step 5: Write the failing API test**

In the assets integration test, after seeding a snapshot with `state_reason='premium_sanity'`, assert `/v1/assets` and `/v1/assets/{sym}/state` both return `state_reason == "premium_sanity"`.
Run: `cargo test -p pegana-api state_reason` → Expected: FAIL (field absent).

- [ ] **Step 6: Run migration locally + tests**

Run: `cargo test -p pegana-api && cargo test -p pegana-engine`
Expected: PASS.

- [ ] **Step 7: Re-run Task 0 baseline (hash gate)** — Expected: byte-identical.

- [ ] **Step 8: Commit**

```bash
git add migrations/ crates/engine-rs/src/main.rs crates/api-rs/src/routes/assets.rs crates/api-rs/tests/
git commit -m "feat(engine,api): emit + surface advisory state_reason"
```

---

## Task 3: EURC — align `/state` freshness with the list endpoint

**Files:**
- Modify: `crates/api-rs/src/routes/assets.rs:770-795` (`state_for_symbol`) + `StateResp:700-716`
- Test: `crates/api-rs/tests/` (the existing P3 embed test at ~`assets.rs:1015` must stay green)

**Root cause (validated):** list applies a 15-min freshness gate → collapses to `null`/`UNKNOWN`; `/state` has no gate → returns frozen `PEGGED` + `stale:true`. The two contradict for a feed in a known-dark window (EURC FX weekend).

- [ ] **Step 1: Write the failing test**

Seed a stale snapshot (ts = now − 30 min, state = PEGGED) for a test asset. Assert: `/v1/assets/{sym}/state` returns `state = "UNKNOWN"` (not frozen PEGGED) AND `stale = true` AND `state_reason = "stale_source"`. Keep the existing embed test asserting `stale` is still present.
Run: `cargo test -p pegana-api eurc_state_staleness` → Expected: FAIL.

- [ ] **Step 2: Apply staleness→UNKNOWN collapse in `state_for_symbol`**

Change the SELECT so that when `c.ts < now() - INTERVAL '15 minutes'`, the returned `state` is `'UNKNOWN'` and `state_reason` is `'stale_source'`, while still returning the last `discount`/`updated_at` and `stale = true`:
```sql
        SELECT
          CASE WHEN c.ts < now() - INTERVAL '15 minutes' THEN 'UNKNOWN'
               ELSE c.state::text END AS state,
          CASE WHEN c.ts < now() - INTERVAL '15 minutes' THEN 'stale_source'
               ELSE c.state_reason END AS state_reason,
          COALESCE((SELECT since FROM prev), c.ts) AS since,
          c.discount_smooth AS discount, c.intrinsic_usd, c.market_usd,
          c.ts AS updated_at, (c.ts < now() - INTERVAL '15 minutes') AS stale
        FROM current c
```
(This matches the list endpoint's "missing data is not confirming data" semantics. `stale` stays `true` so existing consumers keep their flag.)

- [ ] **Step 3: Run tests** — `cargo test -p pegana-api` → Expected: PASS, including the P3 embed test.

- [ ] **Step 4: Re-run Task 0 baseline (hash gate)** — Expected: byte-identical (read-path only).

- [ ] **Step 5: Commit**

```bash
git add crates/api-rs/src/routes/assets.rs crates/api-rs/tests/
git commit -m "fix(api): /state collapses to UNKNOWN+stale_source when stale (EURC divergence)"
```

> **Note for the executor:** weekend-aware FX semantics (distinguishing "market closed, expected" from "feed failed") is deferred — `stale_source` is the honest interim. Do NOT add a market-calendar here; that is a separate decision.

---

## Task 4: `risk_side` — make the signed discount self-describing (M4)

**Files:**
- Modify: `crates/api-rs/src/routes/assets.rs` (AssetCard + the card builder)
- Test: `crates/api-rs/tests/`

- [ ] **Step 1: Write the failing test**

Assert `/v1/assets` returns `risk_side == "below"` for a USD-anchor stable (a discount, i.e. market < peg, is the risk) and `risk_side == "either"` for a NAV-anchor LST (premium and discount both informative).
Run: `cargo test -p pegana-api risk_side` → Expected: FAIL.

- [ ] **Step 2: Add the field + derivation (from `anchor`/`class`, no hash surface)**

AssetCard:
```rust
    /// Which direction of `discount` is the risk signal, so a consumer reading
    /// the raw signed number knows how to interpret it. Derived from `anchor`:
    /// `"below"` for USD/FX anchors (a discount from peg is the risk),
    /// `"either"` for NAV anchors (premium and discount are both meaningful).
    pub risk_side: String,
```
In the card builder, set `risk_side: if anchor == "NAV" { "either" } else { "below" }.to_string()`.

- [ ] **Step 3: Run tests** — Expected: PASS.
- [ ] **Step 4: Re-run Task 0 baseline** — Expected: byte-identical.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): add risk_side to make signed discount self-describing"`

---

## Task 5: Honour `hylo_onchain_poll_ms` toml field (M2)

**Files:**
- Modify: `crates/indexer-rs/src/sources/hylo.rs:88`

- [ ] **Step 1: Write the failing test** (unit test asserting the toml field is read when env is unset). If a config struct test exists, extend it; else add a focused test that constructs the config with `polling.hylo_onchain_poll_ms = Some(45000)` and asserts the resolved cadence is 45000.
Run: `cargo test -p pegana-indexer hylo_poll` → Expected: FAIL.

- [ ] **Step 2: Wire the toml field as a fallback after env**

`hylo.rs:88`:
```rust
    let cadence = state
        .config
        .hylo_poll_ms
        .or(state.assets.polling.hylo_onchain_poll_ms)
        .unwrap_or(30_000);
```

- [ ] **Step 3: Run tests** — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "fix(indexer): honour hylo_onchain_poll_ms toml field (was silently dead)"`

---

## Task 6: CLI v1 PASS line says "tamper-evident only" (L23)

**Files:**
- Modify: `crates/pegana-replay-cli/src/main.rs:222-233`
- Test: `crates/pegana-replay-cli/tests/` (CLI output test)

- [ ] **Step 1: Write the failing test** — verify a v1 receipt prints `PASS (tamper-evident only)` and a v2 prints `PASS (re-derived)`.
Run: `cargo test -p pegana-replay-cli pass_wording` → Expected: FAIL.

- [ ] **Step 2: Change the v1 branch wording**

`main.rs:222-225`:
```rust
        " (re-derived)"
    } else {
        " (tamper-evident only; v1 not re-derived)"
    };
```

- [ ] **Step 3: Run tests** — Expected: PASS. **Re-run Task 0 baseline** — v2 line unchanged (still `(re-derived)`).
- [ ] **Step 4: Commit** — `git commit -m "docs(cli): v1 PASS states tamper-evident only (not re-derived)"`

---

## Task 7: Web — relabel "Verify integrity (hash)" + roadmap note (M19/M17)

**Files:**
- Modify: `web/app/backtest/2025-10-10-usde-depeg/static-receipt-verifier.tsx` (the "Verified" label ~`:55-57`)
- Modify: `web/lib/verify-receipt.ts` (doc comment, no logic change)
- Test: `web/` vitest (component/snapshot test if one exists; else a string assertion)

- [ ] **Step 1: Write/extend the failing test** — assert the button/label text contains "integrity" and NOT a bare "Verified" that implies recomputation; assert presence of a roadmap note that correctness re-derivation is not yet in-browser.
Run: `npx vitest run verify` (from `web/`) → Expected: FAIL.

- [ ] **Step 2: Relabel + add the note**

In `static-receipt-verifier.tsx`, change the success copy from "Verified — hash matches" to:
- Button: `Verify integrity (hash)`
- Success: `Integrity verified — the published bundle hashes to its committed value (tamper-evident). Correctness re-derivation in the browser is on the roadmap.`
No change to `verifyReceipt()` logic; update only the doc comment in `verify-receipt.ts` to state the same scope.

- [ ] **Step 3: Run vitest** — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "fix(web): relabel verify as integrity/tamper-evidence; re-derive is roadmap (M19)"`

---

## Task 8: Honest `assets.toml` header (H11) — doc-only, hash-safe

**Files:**
- Modify: `assets.toml:1` (repo root — NOT under `crates/`)

**Resolved facts (2026-06-29):** 65 total `[[assets]]` entries; only 1 carries `active = false` → ~64 active at runtime (`default_active()=true`). **`monitoring_only` is NOT in this file — it is set by DB migrations (0048+), so the calibrated-vs-beta split is not countable from the toml.** Current header falsely says "26 active, 28 total" (off by ~37).

> **Hash-safe (verified):** `canonical_assets_hash` parses TOML → re-serializes, stripping comments (`canonical.rs:22-28`, tests `:108,170-180`). A header-comment edit cannot change any receipt hash.

- [ ] **Step 1: Confirm counts (sanity, in case entries changed)**

```bash
grep -c '^\[\[assets\]\]' assets.toml      # expect 65
grep -c 'active = false' assets.toml        # expect 1
```

- [ ] **Step 2: Rewrite the header** to state the true numbers and the DB-driven calibration caveat:
```toml
# Pegana — Asset universe (65 entries; ~64 active on mainnet, 1 inactive via
# `active = false`). NOTE: calibration status (calibrated vs monitoring_only/beta)
# is NOT declared here — it is set by DB migrations (0048+). Do not infer the
# beta split from this file. Counts updated 2026-06-29; keep in sync when adding
# entries or flipping `active`.
```

- [ ] **Step 3: Verify hash-invariance + count accuracy**

```bash
cargo run -q -p pegana-replay-cli --bin pegana-replay -- --bundle docs/backtests/2025-10-10-usde-depeg/receipts/USDe-004.json   # must still PASS, recomputed receipt 31c06db4fc9a
sed -n '1,3p' assets.toml                    # header reads true
```

- [ ] **Step 4: Commit** — `git commit -m "docs(assets): honest header (was 26/28; real 65 entries/~64 active)"`

---

## Task 9: `METHODOLOGY.md` → 0.4.0 (H12) — doc-only

**Files:**
- Modify: `METHODOLOGY.md` (title `:1`, version refs `:132,153,206-208,299`)
- Source of truth: `crates/methodology/src/thresholds.rs` (0.3.x→0.4.0 logic), ADR-0023/0025/0026.

- [ ] **Step 1: Diff doc vs code** — list every place METHODOLOGY.md says v0.2.0 / omits BLACK_SWAN-from-CR / omits NAV premium-sanity.
```bash
grep -n '0\.2\.0\|black.swan\|premium' METHODOLOGY.md
```

- [ ] **Step 2: Update version to 0.4.0 + add the missing sections**, sourced from `thresholds.rs` (premium_sanity gate, BLACK_SWAN auto-exits via hysteresis per ADR-0025, CR-deadband per ADR-0023). Keep "SAS"/SPL-Memo wording as-is (already correct). Add a one-line note that anti-backdating is enforced in the closed sibling repo (not outsider-verifiable from this repo).

- [ ] **Step 3: Verify** — `grep -c '0\.2\.0' METHODOLOGY.md` → Expected: 0 (no stale version refs). Cross-check the version matches `version.rs` (0.4.0).

- [ ] **Step 4: Commit** — `git commit -m "docs(methodology): bring METHODOLOGY.md to 0.4.0 (premium-sanity, BLACK_SWAN, ADR-0025)"`

---

## Task 10: One hosting SKU across docs (M15) — doc-only

**Files:**
- Modify: `README.md:102,121`, `docs/spec.html:387,1607-1609,1720`, `docs/.../04-data-model.md:340`

- [ ] **Step 1: Pick the truth** — README's CAX21 (~$8.50/mo) is newest/most-specific. Confirm against the real prod box if the founder provides the invoice (else use CAX21 and note "verify against invoice").

- [ ] **Step 2: Make all three agree** — set the same SKU + price; mark `spec.html` as a superseded historical doc if it's the stale $5/CX22 one.
```bash
grep -rn 'CAX21\|CX22\|CPX32\|€4.50\|\$5\|\$8.50' README.md docs/spec.html docs/**/04-data-model.md
```

- [ ] **Step 3: Verify** — the grep above returns one consistent SKU/price story.
- [ ] **Step 4: Commit** — `git commit -m "docs: single source of truth for hosting SKU/cost (M15)"`

---

## Task 11: "in this replay" denominator (L22) — doc/web

**Files:**
- Modify: `web/app/backtest/page.tsx:46,88` + sibling `2025-10-10-usde-depeg/page.tsx:88`

- [ ] **Step 1: Write/extend the failing test** (string assertion the headline includes a replay qualifier).
Run: `npx vitest run backtest` → Expected: FAIL.

- [ ] **Step 2: Add the qualifier** — change "Ten assets, 43,210 one-minute observations, 123 verifiable transitions." to "In the 2025-10-10 replay: ten assets, 43,210 one-minute observations, 123 verifiable transitions." (and the sibling "freezes 43,210 Pyth observations" → "…in this 2025-10-10 replay").

- [ ] **Step 3: Run vitest** — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "docs(web): qualify backtest headline numbers as replay-scoped (L22)"`

---

## Sprint exit criteria

- [ ] All 11 tasks committed on the sprint branch.
- [ ] `cargo test` (workspace) + `npx vitest run` (web) green.
- [ ] **Task 0 hash baseline re-run after the final task: byte-identical** (zero receipt-hash change across the whole sprint).
- [ ] `/code-review` (high) + `/review-and-iterate` clean on the full sprint diff.
- [ ] Deploy: web via Vercel on merge to `main`; API/engine/indexer via `scripts/deploy.sh --migrate` (Task 2 adds a migration) **only after explicit founder OK**.

## Self-review (done by author)

- **Spec coverage:** Sprint A items H2(T1+T2)·EURC/M5(T3)·M4(T4)·M2(T5)·L23(T6)·M19/M17(T7)·H11(T8)·H12(T9)·M15(T10)·L22(T11) — all present.
- **Placeholder scan:** migration number `00NN` and the `assets.toml`/`spec.html` paths are intentionally resolved at execution (`ls migrations/ | tail`, `grep -rl`). No "add error handling"-style placeholders.
- **Type consistency:** `state_reason: Option<String>` identical across Receipt (T1), snapshot/engine (T2), AssetCard + StateResp (T2/T3); `risk_side: String` (T4) consistent.
