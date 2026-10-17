# Implementation Spec — Expose `sol_per_lst` + `confidence` on `GET /v1/assets`

**Status: NO-GO as specified.** The SQL/struct/serde mechanics are correct and strictly additive, and the change is implementable exactly as the design describes. The blocker is a **data-integrity defect in the display contract**, not in the serializer: the new fields are read from unbounded `ORDER BY ts DESC LIMIT 1` LATERALs, so during an indexer/engine outage the endpoint re-serves a *stale* `confidence:"high"` (and a stale `sol_per_lst`) with no freshness signal, and the proposed UI renders it as a live green oracle-confidence badge / live NAV. That violates the same hardening-H1/H9 invariant the engine enforces at write-time ("missing data is not confirming data"). The fix is small, additive, and below (HIGH-1). Ship the struct/SQL exactly as written **plus** the freshness bound + UI gating, then it is GO.

This spec is copy-pasteable. All file:line references were re-verified against the working tree on 2026-06-03.

---

## Summary

Add two optional, nullable fields to the `AssetCard` response of `GET /v1/assets` and `GET /v1/assets/{symbol}`:

- **`sol_per_lst`** — for Sanctum LSTs, the stake-pool SOL/share, a `rust_decimal::Decimal` serialized as a JSON **string**. Already persisted inside `intrinsic_snapshots.meta` JSONB as a quoted JSON string (`indexer-rs/src/sources/sanctum.rs:137-140`). Unblocks the NAV / Proof-of-Reserves decomposition (`intrinsic_usd = sol_per_lst × SOL/USD`).
- **`confidence`** — the Pyth oracle confidence bucket (`high|medium|low|unknown`), a plain TEXT column. Already persisted as `discount_snapshots.confidence TEXT NOT NULL` and already materialized inside the existing `d` LATERAL (`SELECT *`). Unblocks an "oracle confidence" badge.

No migration. No new joins. No N+1. No floats. No new panics on the hot path. Both fields use `#[serde(skip_serializing_if = "Option::is_none")]` so non-LST / intrinsic-only assets **omit** the key (not `null`), matching how `series_24h` is already handled.

---

## Data paths verified (from exploration of the working tree)

| Claim | Verified at | Result |
|---|---|---|
| `AssetCard` struct + serde shape | `crates/api-rs/src/routes/assets.rs:41-56` | `#[derive(Debug, Serialize, ToSchema)]`; `series_24h` already uses `#[serde(skip_serializing_if = "Option::is_none")]` at :54. `Decimal` imported at :11, `sqlx::Row` at :13. |
| LIST query outer SELECT | `assets.rs:124-132` | Last projected column is `s.series_24h` at **:132 with NO trailing comma** (`:133` is `FROM assets a`). ⚠️ comma fix required (MED-1). |
| LIST `i` LATERAL | `assets.rs:139-143` | `SELECT value_usd, ts FROM intrinsic_snapshots ins ... LIMIT 1`. Projection must widen. |
| LIST `d` LATERAL | `assets.rs:134-138` | `SELECT * FROM discount_snapshots ds ... LIMIT 1` — **unbounded** (no time filter). `confidence` already in scope as `d.confidence`. |
| DETAIL query (mirror) | `assets.rs:222-257` | Identical SQL; comment at :221 confirms intentional mirror. `i` LATERAL at :240, outer SELECT last col `s.series_24h` at :232. |
| `row_to_card` panic-free reads | `assets.rs:188-203` | All nullable reads use `r.try_get("...").ok()` → `None` on NULL/missing/decode-mismatch. No `.unwrap()/.expect()`. |
| `sol_per_lst` source + persistence | `crates/indexer-rs/src/sources/sanctum.rs:128, 137-140` | `let sol_per_lst = Decimal::from(lamports) / Decimal::from(1_000_000_000u64);` then `meta = json!({"sol_per_lst": sol_per_lst, "lamports": lamports})`. Stored as a **quoted JSON string** because the indexer's `rust_decimal` also has `serde` (serialize_str). |
| `confidence` source + buckets | `crates/engine-rs/src/state.rs:284-299` | `pyth_confidence_label` returns `Some("high"|"medium"|"low")`; ratio thresholds `< 0.001` → high, `< 0.01` → medium, else low. `None` when missing/stale/zero. |
| `None`→`"unknown"` substitution + the staleness invariant | `state.rs:280-283` (rustdoc) | "Callers MUST treat `None` as 'unknown / do not confirm' rather than silently upgrading to the best bucket — missing data is not confirming data (hardening H1/H9/H12)." This is the load-bearing rationale for HIGH-1. |
| `discount_snapshots.confidence` type | `migrations/0001_initial.sql:95` | `confidence TEXT NOT NULL`. No cast needed. |
| `alerts.confidence` type (the audit mirror) | `migrations/0001_initial.sql:163` | `confidence TEXT NOT NULL` — **also TEXT**, so the `::text` cast at `audit.rs:154` is a harmless redundancy, NOT an enum cast (corrects LOW-4). |
| `intrinsic_snapshots.meta` | `migrations/0001_initial.sql:52-60` | `meta JSONB` (nullable). **No `sol_per_lst` column exists** anywhere. |
| No ALTER for either field | `grep -rni 'sol_per_lst' migrations/` → none; no `ALTER ... confidence` | Confirmed — no migration needed. |
| `rust_decimal` serde feature (string, not float) | `Cargo.toml:48` | `rust_decimal = { version = "1", features = ["serde"] }` — default `serialize_str`, NOT `serde-float`. `serde_json` (`Cargo.toml:37`) has no `arbitrary_precision`. |
| Additive safety — no `deny_unknown_fields` | `grep -rn deny_unknown_fields --include=*.rs .` → **zero** | Unknown JSON keys are ignored by every Serde consumer. |
| CLI / common-verify don't read `/v1/assets` | `grep -rn '/v1/assets' crates/pegana-replay-cli crates/common-verify` → none | Only `/v1/audit` consumers exist; unaffected. |
| Frontend `AssetCardData` | `web/lib/api/types.ts:22-35` | No index signature; `series_24h?: number[]` already optional. `AssetClass` union (`:9-17`) uses `lst`, `synth_lev`, `stable_fx`. |
| Web client does no response validation | (design claim) `web/lib/api/client.ts:37` | `res.json() as Promise<T>` — unknown keys ignored. Additive-safe for deployed builds. |

---

## The change

### 1. Struct — `crates/api-rs/src/routes/assets.rs:41-56`

Append two fields after `series_24h` (`:55`), inside the existing derive. No new imports, no derive change.

```rust
#[derive(Debug, Serialize, ToSchema)]
pub struct AssetCard {
    pub symbol: String,
    pub name: String,
    pub mint: String,
    pub class: String,
    pub peg_target: String,
    pub decimals: i16,
    pub state: Option<String>,
    pub discount: Option<Decimal>,
    pub intrinsic_usd: Option<Decimal>,
    pub market_usd: Option<Decimal>,
    pub updated_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_24h: Option<Vec<f64>>,

    /// Stake-pool SOL per share for Sanctum LSTs (`rust_decimal`, serialized
    /// as a JSON string). Omitted for non-LST assets. Reflects the LATEST
    /// intrinsic snapshot — read together with `updated_at` for freshness;
    /// NAV decomposition is `intrinsic_usd = sol_per_lst × SOL/USD`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sol_per_lst: Option<Decimal>,

    /// Pyth oracle confidence bucket: `high` | `medium` | `low` | `unknown`.
    /// Scopes the *price-oracle confidence interval only* (conf/price ratio),
    /// NOT market-quote / route-depth reliability. Omitted when no discount
    /// snapshot exists yet (intrinsic-only fallback). Reflects the LATEST
    /// snapshot — an omitted/`unknown` value means "no current signal" and
    /// MUST NOT be rendered as a positive bucket (hardening H1/H9).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<String>,
}
```

- `sol_per_lst: Option<Decimal>` mirrors `discount`/`intrinsic_usd`/`market_usd` (`:50-52`). No `#[serde(with=…)]` needed — `Decimal` serializes to a string under the `serde` feature.
- `confidence: Option<String>` mirrors `state: Option<String>` (`:49`). Plain TEXT bucket. Kept as `String` (not a Rust enum) deliberately: an enum would need a fallible decode and risk a panic/`None` on an unmapped future bucket, contradicting the no-panic constraint. The doc-comment surfaces the vocabulary into the OpenAPI schema description (utoipa).

### 2. `row_to_card` — `crates/api-rs/src/routes/assets.rs:188-203`

Append two panic-free reads after `series_24h`:

```rust
fn row_to_card(r: sqlx::postgres::PgRow) -> AssetCard {
    AssetCard {
        symbol: r.get("symbol"),
        name: r.get("name"),
        mint: r.get("mint"),
        class: r.get("class"),
        peg_target: r.get("peg_target"),
        decimals: r.get("decimals"),
        state: r.try_get("state").ok(),
        discount: r.try_get("discount").ok(),
        intrinsic_usd: r.try_get("intrinsic_usd").ok(),
        market_usd: r.try_get("market_usd").ok(),
        updated_at: r.try_get("updated_at").ok(),
        series_24h: r.try_get("series_24h").ok(),
        sol_per_lst: r.try_get("sol_per_lst").ok(),
        confidence: r.try_get("confidence").ok(),
    }
}
```

`.try_get(...).ok()` → a missing/NULL/type-mismatch column degrades to `None`. (Caveat in MED-2: this also swallows a decode error silently — defended by the positive integration assertion below.)

### 3. SQL — LIST query (`assets.rs:122-160`) — TWO edits

**Edit A — widen the `i` LATERAL projection (`:140`):**

```sql
-- BEFORE (:140)
SELECT value_usd, ts FROM intrinsic_snapshots ins
-- AFTER
SELECT value_usd, ts, (meta->>'sol_per_lst')::numeric AS sol_per_lst FROM intrinsic_snapshots ins
```

`meta->>'sol_per_lst'` returns the JSON inner **text** (`"1.117000000"` → `1.117000000`); `::numeric` parses it to NUMERIC in Postgres, which sqlx decodes to `Decimal`. When `meta` is NULL or lacks the key (every non-LST source), `->>` yields NULL → cast yields NULL → `Option::None`. **Keep the `::numeric` cast** — decoding raw TEXT into `Option<Decimal>` would error (see Risks).

**Edit B — outer SELECT (`:124-132`). Add a trailing comma to `:132`, then two projections (⚠️ MED-1):**

```sql
            COALESCE(d.ts, i.ts) AS updated_at,
            s.series_24h,
            i.sol_per_lst,
            d.confidence
        FROM assets a
```

- `:132` `s.series_24h` was the comma-less final column — it now needs a comma.
- `d.confidence` is **qualified** (the `d` LATERAL alias) to match the `d.market_usd`/`d.discount_smooth` style and avoid any ambiguity. It is already TEXT — **no `::text` cast**.

### 4. SQL — DETAIL query (`assets.rs:222-257`) — apply the IDENTICAL two edits

- Edit A at `:240` (widen the `i` LATERAL exactly as above).
- Edit B at `:232` (`s.series_24h` → `s.series_24h,` then `i.sol_per_lst,` + `d.confidence`).

The detail query is a deliberate mirror (comment at `:221`). **Both blocks must change in the same commit** or `GET /v1/assets` and `GET /v1/assets/{symbol}` disagree.

### 5. HIGH-1 freshness bound (REQUIRED for GO — see Adversarial review)

Add a time bound to **both** `d` LATERALs so a long outage cannot re-serve a stale positive bucket on the wire. In the LIST query `:135-137` and DETAIL query `:235-237`, change:

```sql
-- BEFORE
SELECT * FROM discount_snapshots ds
WHERE ds.asset = a.symbol
ORDER BY ds.ts DESC LIMIT 1
-- AFTER
SELECT * FROM discount_snapshots ds
WHERE ds.asset = a.symbol
  AND ds.ts >= now() - INTERVAL '15 minutes'
ORDER BY ds.ts DESC LIMIT 1
```

15 min is a generous outer bound well past the engine's per-cycle cadence; a real outage yields `d = NULL` → `confidence`, `state`, `discount`, `market_usd` all NULL → `confidence` omitted, and the endpoint falls into its existing intrinsic-only fallback path (`state = 'UNKNOWN'`). This makes "absent" mean "no current signal" **server-side**, instead of trusting every client to gate.

> ⚠️ **This bound also affects `discount`, `state`, `market_usd`, `intrinsic_usd`** (they read from the same `d` LATERAL). That is a behavior change to existing fields, *intended* and correct (a >15-min-stale card should fall back to `UNKNOWN`/intrinsic, not pretend the last discount is live), but it is **not** purely additive to those existing fields. **Decision required by the owner:** if strict additivity on the existing fields must be preserved for this change, implement HIGH-1 as **client-side gating only** (use the existing `updated_at = COALESCE(d.ts, i.ts)` already on the response, `assets.rs:131`) and defer the server bound to a separate, explicitly-flagged change. Recommended: ship the server bound — it closes the H1/H9 hole at the source — but call it out in the PR as a behavior change to the discount fields, not silent.

---

## Migration? — NO

No new migration. Both fields already persist in tables the assets query already joins:

1. **`confidence`** is a real column: `discount_snapshots.confidence TEXT NOT NULL` (`migrations/0001_initial.sql:95`), already materialized by the `d` LATERAL's `SELECT *` — it just isn't projected to the outer SELECT.
2. **`sol_per_lst`** lives inside `intrinsic_snapshots.meta JSONB` (`migrations/0001_initial.sql:52-60`; the table has **no** `sol_per_lst` column), written by the indexer at `sanctum.rs:137-140`. Extracted via a JSON path on the existing `i` LATERAL — zero new joins/tables; only the projection widens.

No `ALTER TABLE` exists for either across `migrations/` (verified by grep). sqlx here uses runtime-checked `sqlx::query` (not the compile-time `query!` macro), so **no `DATABASE_URL` / offline-cache regeneration** is needed.

---

## Frontend types + UI

### `web/lib/api/types.ts`

Add the union near the other unions (after `PegTarget`, `:19`):

```ts
export type PythConfidence = "high" | "medium" | "low" | "unknown";
```

Extend `AssetCardData` (`:22-35`), after `series_24h?` (`:34`):

```ts
  series_24h?: number[];         // optional — backend may not deliver yet
  /** LSTs only — stake-pool SOL/share (rust_decimal as string). Omitted for
   *  non-LST assets. NAV = sol_per_lst × SOL/USD. Read WITH updated_at. */
  sol_per_lst?: string;
  /** Pyth oracle confidence bucket (price interval only, NOT market quality).
   *  Omitted when no discount snapshot exists. Treat omitted/undefined as
   *  "unknown" / neutral — never upgrade a missing value to a good bucket. */
  confidence?: PythConfidence;
```

Both `?`-optional (matches `skip_serializing_if = Option::is_none` → key absent, not `null`). Deployed web builds ignore the new keys (no `deny_unknown_fields`, no runtime validation at `client.ts:37`).

### NAV / Proof-of-Reserves decomposition (LST cards)

Render only when **both** `sol_per_lst` and `intrinsic_usd` are present (so non-LSTs naturally skip it). The SOL/USD multiplier is recoverable client-side **without scraping Pyth** (honors the no-client-scrape constraint), because both numbers are already on the response:

```
SOL_USD = Number(intrinsic_usd) / Number(sol_per_lst)
// e.g. 1.117 SOL/share × $147.20 = $164.42
```

⚠️ **MED-2 caveat (cross-cycle ratio):** `intrinsic_usd` is `COALESCE(d.intrinsic_usd, i.value_usd)` (`:129`) and `sol_per_lst` comes from `i.meta`. When a discount row wins, `intrinsic_usd` is from `d` but `sol_per_lst` is from `i` — if `i.ts ≠ d.ts` the derived `SOL_USD` is a *cross-cycle* ratio, not a coherent point-in-time price. Mitigations (pick one):
- **Preferred:** display only the factored form `sol_per_lst SOL/share × $SOL` and source the `$SOL` figure from `/v1/stats` or the SOL/USD asset card rather than dividing across the d/i boundary; OR
- gate the NAV row on the intrinsic row's own age (requires projecting `i.ts` — see optional additive field below); OR
- at minimum, label the derived SOL/USD as "implied" and gate the whole row on `updated_at` freshness.

> Optional additive field if you want clean intrinsic-age gating: project `i.ts AS sol_per_lst_at` and add `pub sol_per_lst_at: Option<DateTime<Utc>>` (skip-if-none) to the struct + `sol_per_lst_at?: string` to the type. Fully additive, lets the UI gate the NAV row on the intrinsic row's own freshness instead of the discount-biased `updated_at`. Defer unless the NAV UI needs it.

### Pyth oracle confidence badge

Map the bucket → badge, treating **omitted/undefined identically to `"unknown"`** (neutral/grey "no signal"); never default a missing value to a good bucket:

```ts
const badge = (c: PythConfidence | undefined) =>
  c === "high"   ? "ok"      :   // green
  c === "medium" ? "warn"    :   // amber
  c === "low"    ? "danger"  :   // red
  /* unknown | undefined */ "neutral"; // grey — "no current signal"
```

Label it explicitly **"Pyth oracle confidence"** (not bare "confidence"/"data quality") — it scopes the price-oracle interval only, not market-quote reliability (MED-3). Worst-of-feeds strictness is already collapsed server-side, so the badge reads one value. Gate on `updated_at` freshness per HIGH-1 (or rely on the server-side 15-min bound, which already omits the field on staleness).

Both consumers are pure-additive reads on `AssetCardData`; cards that don't reference the fields are unaffected.

---

## Adversarial review outcome — **go = false**

Issues sorted critical-first. The change is mechanically sound; the no-go is solely the staleness/display-integrity defect (HIGH-1), which has a small additive fix.

### HIGH-1 — Stale confidence served without a freshness signal (misrepresents oracle certainty)
The `d` LATERAL is unbounded `ORDER BY ds.ts DESC LIMIT 1` (`assets.rs:135-138` / `:235-238`). The engine only *writes* a discount row when both sides are fresh (it gates and maps stale→`None`→`"unknown"`, per `state.rs:284-326`). But the **read path** has no time bound: during a Jupiter/indexer outage or engine downtime it re-serves the last good row — e.g. `confidence:"high"` hours old — and the proposed UI renders it as a live green badge. This is exactly the H1/H9 failure mode on the display side (rustdoc `state.rs:280-283` mandates the opposite). Note the `/v1/audit` confidence the design "mirrors" is *not* comparable: `audit.rs:154` reads `alerts.confidence`, frozen at alert-fire time (an immutable receipt, point-in-time-correct by construction); the assets confidence is a live claim about *now* and inherits a staleness obligation the audit endpoint never had.
**Fix:** Apply the §5 server-side `AND ds.ts >= now() - INTERVAL '15 minutes'` bound to **both** `d` LATERALs (stale → omit) **and** gate the badge/NAV on `updated_at` in the UI. (Owner decision on whether the server bound — which also touches `discount`/`state`/`market_usd` — is acceptable as a behavior change, or whether to do client-only gating; see §5.)

### MED-1 — SELECT-list comma omission → request-time SQL syntax error
`s.series_24h` at `:132` (LIST) and `:232` (DETAIL) are the comma-less final columns. Appending `i.sol_per_lst` literally "after `s.series_24h`" produces `s.series_24h\n i.sol_per_lst` — invalid SQL. Because this is runtime-checked `sqlx::query` (not `query!`), `cargo check` will **not** catch it; it fails only at request time against a live DB.
**Fix:** Add the trailing comma to `:132`/`:232` (see Edit B). Hit the endpoint locally (or add a smoke test) before deploy.

### MED-2 — `try_get(...).ok()` silently swallows a decode mismatch as `None`
If anyone drops the `::numeric` cast (decoding raw TEXT into `Option<Decimal>`), `r.try_get::<Decimal,_>("sol_per_lst").ok()` returns `None` for **every** LST with no error/log/500/test-failure — an invisible regression until a human notices the missing field in prod.
**Fix:** Keep the `::numeric` cast exactly. Add a **positive** integration assertion (below) that an LST's `sol_per_lst` parses as a Decimal AND a non-LST omits the key — converts a silent-`None` into a red test.

### MED-3 — Cross-cycle NAV ratio + over-broad "confidence" label
(a) `SOL_USD = intrinsic_usd / sol_per_lst` mixes a `d`-sourced `intrinsic_usd` with an `i`-sourced `sol_per_lst` when their timestamps differ → not a coherent point-in-time price. (b) `confidence` is per-feed worst-of the *Pyth conf/price ratio only* — it says nothing about Jupiter market-quote quality / thin-liquidity sources (cf. the pbUSDC DexScreener garbage). Exposed as a bare top-level `confidence`, users will read it as overall data quality.
**Fix:** (a) Display the factored form and source `$SOL` from `/v1/stats`, or gate the NAV row on intrinsic-row age (optional `sol_per_lst_at`), or label the implied SOL/USD and gate on `updated_at`. (b) Name it "Pyth oracle confidence" in type + UI; document the scope in the field doc-comment.

### LOW-1 — OpenAPI schema auto-diff (informational)
`AssetCard` derives `ToSchema`; the two optional fields appear in `/openapi.json` after rebuild. Additive (optional, non-required). No action — note in the PR so SDK owners aren't surprised. utoipa keys optionality off `Option<T>` (present), so they render correctly; it won't model `confidence` as an enum (renders as string) — cosmetic; the doc-comment supplies the vocabulary.

### LOW-2 — 5s Redis list cache transient shape
The unfiltered `/v1/assets` serves pre-serialized bytes from a 5s cache (`assets.rs:26-27, 93-114, 174-183`); the OLD shape is returned for up to 5s post-deploy. Filtered (`?class=`/`?peg=`) requests bypass the cache (`:74`) and show the fields immediately — so during the window the same deploy returns different shapes by query param. Harmless/additive. No code change; note in runbook (wait >5s or validate `?class=lst`). Any §5 freshness bound is likewise cached for ≤5s — acceptable.

### LOW-3 — Mirror drift
List and detail are intentional copies (`:221`). Every SQL edit (two projections, the widened `i` LATERAL, the §5 bound) must land in **both** `:122-160` and `:222-257` or the endpoints disagree.

### LOW-4 — Correct the audit-cast rationale in the source design
The design claimed `audit.rs:154` casts `a.confidence::text` "because that path also handles enum-typed columns" — **false**. `alerts.confidence` is `TEXT NOT NULL` (`migrations/0001_initial.sql:163`), same type as `discount_snapshots.confidence` (`:95`); the `::text` is a redundancy. The *conclusion* (no cast needed on `d.confidence`) is right; drop the wrong premise so it isn't propagated.

---

## Ordered implementation steps

1. **Struct** (`assets.rs:41-56`): append `sol_per_lst: Option<Decimal>` and `confidence: Option<String>` with `#[serde(skip_serializing_if = "Option::is_none")]` and the doc-comments from §1.
2. **`row_to_card`** (`assets.rs:188-203`): append `sol_per_lst: r.try_get("sol_per_lst").ok(),` and `confidence: r.try_get("confidence").ok(),`.
3. **LIST query** (`assets.rs:122-160`): (a) `:140` widen `i` LATERAL to `SELECT value_usd, ts, (meta->>'sol_per_lst')::numeric AS sol_per_lst FROM intrinsic_snapshots ins`; (b) `:132` add trailing comma, then `i.sol_per_lst,` + `d.confidence`; (c) **HIGH-1** `:135-137` add `AND ds.ts >= now() - INTERVAL '15 minutes'` to the `d` LATERAL.
4. **DETAIL query** (`assets.rs:222-257`): apply the identical (a)/(b)/(c) at `:240`, `:232`, `:235-237`.
5. **No migration. No new imports.** `Decimal` (`:11`), `sqlx::Row` (`:13`), `DateTime/Utc` (`:10`) already imported.
6. **OpenAPI**: nothing manual — `ToSchema` regenerates `/openapi.json` with the two optional fields on rebuild.
7. **Frontend** (`web/lib/api/types.ts`): add `export type PythConfidence = ...`; append `sol_per_lst?: string` + `confidence?: PythConfidence` to `AssetCardData` after `:34`.
8. **Integration test** (`crates/api-rs/tests/http_endpoints.rs`): add a positive assertion (MED-2 defense) — fetch `/v1/assets`, assert an LST (e.g. `jitoSOL`) has `sol_per_lst` parsing as Decimal, and a non-LST (e.g. `USDC`) omits the key. The existing `assets_list_has_canonical_universe` test asserts only `is_some()` on a whitelist and never asserts absence → passes unchanged regardless.
9. **Frontend UI**: NAV-decomposition row guarded on `sol_per_lst` + `intrinsic_usd` presence (factored display per MED-2); "Pyth oracle confidence" badge mapping `undefined → "unknown" → neutral` (MED-3), gated on `updated_at`/server bound.
10. **Verify additivity**: re-confirm zero `deny_unknown_fields`; CLI/common-verify don't read `/v1/assets`; run the existing http_endpoints test.

---

## Verification plan

```bash
# Compile — runtime-checked sqlx::query, so no DATABASE_URL needed to compile.
cargo check -p api-rs
cargo build -p api-rs

# Lint hot-path safety: no new unwrap/expect introduced in the route file.
cargo clippy -p api-rs -- -D warnings
grep -nE '\.unwrap\(\)|\.expect\(' crates/api-rs/src/routes/assets.rs   # expect: no NEW hits on the request path

# Additivity guards (must stay empty / unchanged).
grep -rn deny_unknown_fields --include='*.rs' .                          # expect: zero
grep -rn '/v1/assets' crates/pegana-replay-cli crates/common-verify      # expect: zero

# Existing + new integration tests (needs PEGANA_E2E_STACK / live DB per repo convention).
cargo test -p api-rs --test http_endpoints

# Local smoke against a running stack (catches the MED-1 runtime SQL error the
# compiler can't). Wait >5s after deploy for the Redis list-cache TTL, or use a
# filtered request to bypass the cache.
curl -s localhost:8081/v1/assets | jq '.[] | select(.symbol=="jitoSOL") | {sol_per_lst, confidence, updated_at}'
#   expect sol_per_lst as a STRING ("1.117…"), confidence one of high|medium|low|unknown
curl -s localhost:8081/v1/assets | jq '.[] | select(.symbol=="USDC") | has("sol_per_lst")'
#   expect: false  (key omitted for non-LST)
curl -s 'localhost:8081/v1/assets?class=lst' | jq '.[0] | {sol_per_lst, confidence}'   # bypasses cache → fields immediately
curl -s localhost:8081/v1/assets/jitoSOL | jq '{sol_per_lst, confidence}'              # detail mirror parity with list entry

# Frontend type-check.
cd web && bun run typecheck   # or: npx tsc --noEmit
```

**Done = GO when:** struct/SQL edits land in BOTH queries; the §5 freshness bound (or client-side `updated_at` gating) is in place with the behavior-change called out; the positive LST/non-LST integration assertion is green; an LST shows `sol_per_lst` as a string + a `confidence` bucket and a non-LST omits `sol_per_lst`; list and detail agree; web typechecks.
