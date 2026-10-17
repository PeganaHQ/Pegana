# Pegana Trust Layer — Design Spec

**Status**: validated v4 — maximalist scope — awaiting user final approval
**Date**: 2026-05-28
**Author**: solo founder + Claude (brainstorming + 3 validation passes)
**Validation passes**:
- v1: written from Explore-agent summary (rejected by user as not 100% grounded)
- v2: rewritten after reading actual engine/state/thresholds/common/dispatcher/MCP/bot source code; validated against context7 docs for Kamino, Drift, Pyth, Switchboard, Jupiter Lend, MarginFi, Loopscale, MCP spec, cargo-dist, RFC 8785
- v3: sequencing + scope adjustments — added Phase 0 (USDe+JLP parallel), deferred Phase 11 publication to post-coverage, added methodology lifecycle (Section 4.11), `/audit` index (Section 4.12), OG images (Section 4.13), `/methodology` page (Section 4.14), Sigstore attestations via cargo-dist (Section 4.7a), pre-flight `alert_events` confirmation (Section 10)
- v4: maximalist scope — ALL 7 "ADD SOON" features promoted to v0.1.0. New sections 4.15 (on-chain receipt commitment via Solana SPL Memo), 4.16 (RSS/Atom audit feed), 4.17 (embed widget script + iframe), 4.18 (CSV export streaming), 4.19 (auto-generated TS+Python SDKs), 4.20 (calibration changes feed from git), 4.21 (reproducible builds + CI verification)
**Sub-project**: A of {A=Trust Layer, B=Risk Signals, C=Loop Intelligence, D=User Surfaces, E=Predictive}
**Depends on**: nothing (foundation)
**Blocks**: B, C, D, E (all downstream sub-projects ship audit evidence on top of this)

---

## 1. Why this exists

After the 2025-10-10 crypto crash, Pegana's positioning shifts from "stablecoin watch" to "risk infrastructure that downstream protocols and agents can trust." Trust is a property of the *evidence* a system produces, not a marketing claim. Every alert Pegana emits must be:

1. **Reproducible** — anyone with the same inputs + methodology version can recompute the same output.
2. **Explainable** — the inputs, thresholds, and rule version are visible alongside the result.
3. **Verifiable** — the evidence cannot be altered after the fact without detection.

Audit, in this spec, means *validation of decisions*: each alert is a decision, and each decision must be checkable against the rule that was in force at the moment of decision.

This sub-project delivers the minimum infrastructure for that. Sub-projects B, C, D, E will all emit alerts on top of this foundation — no downstream work can claim "auditable" until this ships.

---

## 2. Scope

**In scope**:

- A `methodology` crate (pure functions, versioned) that the engine and the replay CLI both call.
- An append-only `alert_evidence` Postgres table populated atomically with each alert.
- An `evidence_url` reference threaded through Telegram, webhook, MCP, and a new public web page.
- A dedicated `pegana-replay` CLI (new binary crate `crates/pegana-replay-cli`) that reproduces any alert from its receipt, distributed via cargo-dist mirrored at `releases.pegana.xyz`.
- A published backtest of the 2025-10-10 USDe depeg using the methodology, as a marketing artifact and a regression test.

**Out of scope** (deferred to sub-projects B+):

- New peg states (`VENUE_FRAGMENTATION`, `ORACLE_DEGRADED`, `CASCADE_PRIMED`).
- New assets (JLP, USDS, EURC, BUIDL, OUSG, AUSD, USDG).
- New data sources (Switchboard, Orca TWAP, Phoenix orderbook).
- Loop exposure indexing across Kamino / Jupiter Lend / MarginFi / Loopscale / Drift.
- Cascade simulator.
- Wallet-level risk monitoring (`/connect` command, position scanning).
- Predictive signals (whale movement, mint/burn anomalies).
- On-chain cryptographic commitments (Merkle / hash chains).
- Multi-sig or RBAC for calibration changes.
- Public calibration editor UI.

**Explicitly accepted simplifications**:

- Receipts live in Postgres JSONB, not object storage. Each receipt is 4–15 KB; Postgres handles this volume trivially.
- No separate `audit-store-rs` service. Evidence is written inline in the engine's existing `push_alert` function (after the `alerts` insert; see Section 8 for why this is NOT a single transaction).
- Replay CLI is a dedicated binary crate (`crates/pegana-replay-cli`) shipped via cargo-dist to GitHub Releases mirrored at `releases.pegana.xyz`. Third parties install with one-liner `curl https://releases.pegana.xyz/pegana-replay-installer.sh | sh` — no Rust toolchain required.

**Validation pass 4 — ALL "ADD SOON" features promoted to v0.1.0 (added 2026-05-28 night)**:

User decision: ship maximalist Trust Layer v0.1.0. All 7 items previously categorized "ADD SOON" are now in scope. New sections 4.15–4.21 detail:

- **§4.15** On-chain receipt commitment via Solana SPL Memo (~$0.025/month cost)
- **§4.16** RSS/Atom audit feed `/audit.xml`
- **§4.17** Embed widget (script tag + iframe variants) at `/embed.js` and `/embed/[asset]`
- **§4.18** CSV export `/v1/audit.csv` (streaming via `axum-streams`)
- **§4.19** Auto-generated TypeScript + Python SDKs (published to npm + PyPI)
- **§4.20** Calibration changes feed `/calibration.xml` (from git history)
- **§4.21** Reproducible builds (cargo --locked --frozen + Docker digest pinning + CI verification)

Combined with pass 3 additions: this is the most complete first ship of a peg-risk verifier infrastructure on Solana — covers cryptographic anchoring, syndication, partner integration, programmatic access, and supply-chain transparency.

**Validation pass 3 sequencing decisions (added 2026-05-28 evening)**:

- **USDe + JLP added in parallel** (new Phase 0 in plan): entries land in `assets.toml` with `active=false` at the start of implementation, calibrate passively for 14 days during Trust Layer construction, activate when Trust Layer ships. Makes the 10/10 backtest a *real* marketing artifact ("live monitoring now AND historical backtest").
- **Backtest publication deferred** (Phase 11 of plan moves to Phase 14 — post-coverage): audit infrastructure ships in Phase 1–10; published backtest README + CI gate happen AFTER USDe is live, so the artifact is "live + historical" not "hypothetical only."
- **Methodology lifecycle** (new Section 4.11): every methodology version has a `status: active | deprecated | broken` field. Past alerts emitted by a `broken` version show a banner on the audit page.
- **`/audit` index page** (new Section 4.12): list of recent audits so anyone can discover receipt URLs without prior knowledge.
- **OG images per audit** (new Section 4.13): each `/audit/[id]` ships an `opengraph-image.tsx` rendering asset + transition for shareable Twitter/Telegram previews.
- **`/methodology` web page is built fresh** (new Section 4.14): does not currently exist in `web/app` — created here, not "updated."
- **Sigstore attestations** (Section 4.7a updated above): `github-attestations = true` in cargo-dist config — free, OIDC-keyless. Enabled from day 1.
- **API cache headers**: `/v1/audit/:alert_id` and `/replay-bundle` return `Cache-Control: public, max-age=31536000, immutable` since content is append-only.
- **Pre-flight `alert_events` check** (new step in Section 10): before applying migration 0028, confirm whether the prod `alert_events` view exists. If not, MCP is currently broken in prod and must be fixed first.

---

## 3. Architecture overview

```
                    methodology crate (pure, versioned, no I/O)
                    ─────────────┬──────────────────────────────
                                 │
                ┌────────────────┴────────────────┐
                │                                 │
        engine-rs (runtime)                pegana-replay (public CLI)
                │                                 ▲
                │ emit AlertEvent + Evidence      │
                ▼                                 │ fetch receipt
        Postgres: alerts + alert_evidence ────────┘
                │
                ├─→ dispatcher-rs ──→ Telegram bot   (renders evidence_url)
                │                  └→ webhook        (payload.evidence_url)
                │
                └─→ api-rs ──→ web /audit/[id]   (public evidence page)
                            └→ MCP tools          (include evidence_url)
```

The `methodology` crate is the single source of truth for the calculation. The engine uses it at runtime; the CLI uses it offline. Both link the same version. If a third party builds the CLI against methodology v0.1.0 and tries to verify an alert that was emitted by methodology v0.2.0, the CLI refuses to run.

---

## 4. Components

### 4.1 New crate: `crates/methodology`

Library only. Sole responsibility: all the math that turns raw inputs into a decision. No async, no I/O, no global state.

**Crate dependencies** (locked at design time):

```toml
[package]
name    = "pegana-methodology"
version = "0.1.0"
edition = "2021"

[dependencies]
rust_decimal = { workspace = true }
serde        = { workspace = true }
serde_json   = { workspace = true }
chrono       = { workspace = true }
toml         = { workspace = true }
sha2         = "0.10"
# Canonical JSON encoder (RFC 8785). serde_json_canonicalizer is actively
# maintained (Feb 2026) and 100% RFC-compliant; serde_jcs is abandoned and
# diverges from the RFC on number representation.
serde_json_canonicalizer = "0.3"
thiserror   = { workspace = true }

[dev-dependencies]
proptest = "1"
```

`rust_decimal::Decimal` does not have a native JCS form; the methodology crate serializes Decimals as JSON strings (matching the existing engine convention of `discount.to_string()`). This keeps receipts portable across machines with different float behavior.

**Migrated from existing engine code** (no logic change, just relocation):

- `state_for_bps_discount`, `state_for_bps_discount_aware`, `state_for_cr`, `is_direction_sensitive`
  — moved from `crates/engine-rs/src/thresholds.rs` (which is then deleted).
- `is_plausible_discount_sample`
  — moved from `crates/engine-rs/src/main.rs` (lines 680–682).

**Extracted to pure functions**:

- `compute_discount(intrinsic, market, intrinsic_sol, market_sol, class) -> Decimal`
  — extracted from the LST-aware branch in `try_recompute` (`main.rs:353–362`).
- `apply_ewma_pure(raw, prev, alpha) -> Decimal`
  — extracted from `state.rs:245–254`. The cache mutation stays in `EngineState::apply_ewma`; this function holds only the formula `alpha * raw + (1 - alpha) * prev`.
- `transition_decide(current, candidate, prev_candidate, prev_candidate_since, now, confirm_up_secs, decay_down_secs) -> TransitionDecision`
  — extracted from `state.rs:258–296`. Returns a `TransitionDecision` value describing the new `last_state`, `candidate_state`, and `candidate_since`. The cache mutation stays in `EngineState::transition`; this function is purely a state-machine step that takes `now` explicitly.

**New functions**:

- `methodology_version() -> &'static str`
  — returns `env!("CARGO_PKG_VERSION")` of the methodology crate. Embedded at compile time.
- `methodology_git_sha() -> Option<&'static str>`
  — returns `option_env!("PEGANA_GIT_SHA")`. Populated by Docker build arg in release.
- `canonical_assets_hash(toml_str: &str) -> Result<[u8; 32], Error>`
  — parses TOML, re-serializes with canonical key order, sha256 over the canonical bytes. Comments and formatting do not affect the hash; semantic content does.
- `canonical_receipt_hash(receipt: &Receipt) -> [u8; 32]`
  — canonical JSON encode (sorted keys, no whitespace, RFC 8785 / JCS-style) → sha256.

**Dependencies**: `rust_decimal`, `serde`, `serde_json`, `chrono` (types only), `sha2`, `toml`. No tokio, no sqlx, no reqwest.

**Test policy**: 100% unit test coverage on every public function. Property tests on `apply_ewma_pure` (idempotent at α=0, exact match at α=1) and `transition_decide` (hysteresis correctness across all 6×6 state transition combos). The 8 existing tests in `thresholds.rs` move with the code.

### 4.2 New table: `alert_evidence`

Created by migration `0028_alert_evidence.sql` (next number after `0027_user_alerts_enabled.sql`).

```sql
CREATE TABLE alert_evidence (
    alert_id              UUID        PRIMARY KEY REFERENCES alerts(id),
    methodology_version   TEXT        NOT NULL,
    methodology_git_sha   TEXT,
    assets_toml_sha256    CHAR(64)    NOT NULL,
    inputs_frozen         JSONB       NOT NULL,
    computed              JSONB       NOT NULL,
    replay_artifact       JSONB,
    receipt_sha256        CHAR(64)    NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION alert_evidence_immutable() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'alert_evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER alert_evidence_no_update BEFORE UPDATE ON alert_evidence
    FOR EACH ROW EXECUTE FUNCTION alert_evidence_immutable();
CREATE TRIGGER alert_evidence_no_delete BEFORE DELETE ON alert_evidence
    FOR EACH ROW EXECUTE FUNCTION alert_evidence_immutable();

CREATE INDEX idx_alert_evidence_methodology ON alert_evidence (methodology_version);
CREATE INDEX idx_alert_evidence_assets_hash ON alert_evidence (assets_toml_sha256);
```

**`inputs_frozen` shape** (JSONB, ~2–4 KB):

```json
{
  "asset": "USDe",
  "class": "stable_yield",
  "now": "2026-05-28T14:33:12.043Z",
  "alpha": "0.3",
  "intrinsic_usd": "1.000000",
  "market_usd": "0.987432",
  "intrinsic_sol": null,
  "market_sol": null,
  "ewma_prev": "0.001234",
  "hyusd_cr": null,
  "previous_state": "PEGGED",
  "candidate_state": "DRIFT",
  "candidate_since": "2026-05-28T14:32:38.012Z",
  "thresholds": { "drift": 50, "depeg": 200, "critical": 500 },
  "threshold_kind": "bps",
  "pyth_entries": {
    "USDe/USD": {
      "price": "0.987432",
      "confidence": "0.000891",
      "publish_time": "2026-05-28T14:33:11.987Z"
    }
  },
  "confirm_up_secs": 30,
  "decay_down_secs": 120
}
```

Each field is an input to the methodology call chain that produced the alert. Replay re-executes with exactly these values.

**`computed` shape** (JSONB, ~200 bytes):

```json
{
  "discount_raw": "0.012568",
  "discount_smooth": "0.005934",
  "final_state": "DRIFT",
  "confidence_label": "high"
}
```

**`replay_artifact` shape** (JSONB, ~6–10 KB; `NULL` for `DRIFT` alerts to save storage):

```json
{
  "schema_version": "v1",
  "methodology_version": "0.1.0",
  "methodology_git_sha": "d4a60ff…",
  "assets_toml_canonical": "<full canonicalized TOML>",
  "inputs_frozen": { /* see above */ },
  "expected_computed": { /* see above */ },
  "expected_receipt_sha256": "abc123…"
}
```

The artifact is self-contained: the CLI can verify it without any network access.

**Storage policy**:

- `replay_artifact` is populated for `DEPEG`, `CRITICAL`, `BLACK_SWAN` (and any future critical state).
- `replay_artifact` is `NULL` for `DRIFT`. The `inputs_frozen` + `computed` + `methodology_version` + `assets_toml_sha256` are still enough to reproduce; the artifact just packages them with the canonical TOML for offline use.
- At 100 critical alerts/year × 10 KB = 1 MB/year. Negligible.

### 4.3 Changes to `crates/engine-rs`

- `src/thresholds.rs`: **deleted**. Functions moved to `methodology` crate; this file's imports rewire to `pegana_methodology::*`.
- `src/state.rs`:
  - `apply_ewma`: body becomes `let new = methodology::apply_ewma_pure(raw, self.read_ewma(sym).await, alpha); self.write_ewma(sym, new).await; new`.
  - `transition`: signature changes to take `now: DateTime<Utc>` as a parameter. Body delegates to `methodology::transition_decide`, then writes the resulting `last_state`/`candidate_state`/`candidate_since` back to the cache.
- `src/main.rs`:
  - `try_recompute`: reads `let now = Utc::now()` once at the top (around current line 333), threads `now` into `engine.transition(...)` (currently line 419), into `persist_discount` (currently uses `Utc::now()` directly at line 429), and into `push_alert`.
  - `push_alert`: builds an `AlertEvidence` value from the frozen inputs, computes `receipt_sha256` via `methodology::canonical_receipt_hash`, and writes the new `alert_evidence` row immediately after the `alerts` insert succeeds. The two inserts are separate `sqlx::query` calls, **not** wrapped in a single transaction — see Section 8 for why: if audit persistence fails, the alert must still ship.

### 4.4 Changes to `crates/common`

- `src/lib.rs`: adds `pub struct AlertEvidence { ... }` mirroring the table.
- `src/lib.rs::channels`: no changes (we are not adding a new Redis channel for audit — the audit row is persisted before the alert is pushed to `ALERTS_STREAM`).

### 4.5 Changes to `crates/api-rs`

- `src/main.rs`: registers two new routes:
  - `GET /v1/audit/:alert_id` → `routes::audit::detail`
  - `GET /v1/audit/:alert_id/replay-bundle` → `routes::audit::replay_bundle`
- `src/routes/audit.rs` (new file, ~60 lines): handlers that SELECT `alerts` JOIN `alert_evidence`. The detail endpoint returns a humane JSON; the replay-bundle endpoint returns the `replay_artifact` JSONB directly (with `Content-Disposition: attachment; filename="alert-<id>.json"`).
- `src/openapi.rs`: registers both routes with `utoipa` annotations.
- No authentication required. Audit is public.
- Rate limit: existing IP-based bucket (300/min). No special treatment.

### 4.6 Changes to `crates/dispatcher-rs`

- `src/format.rs::build_send_payload` (the function that builds the bot's `/send` payload):
  - Reads `AUDIT_BASE_URL` from env at startup, defaults to `https://pegana.xyz`.
  - Appends one entry to `vars`: `"evidenceUrl": format!("{base}/audit/{}", event.id)`.
- `src/webhook.rs`: the JSON body sent to webhook subscribers gets a top-level `evidence_url` field. HMAC signature covers the full body, so this is automatically signed. No breaking change for existing subscribers (additive).

### 4.7 New binary crate: `crates/pegana-replay-cli`

**Why not `xtask`**: `xtask` is the Rust convention for internal project tasks (build helpers, codegen) — not for distribution to end users. Mixing a public verifier CLI into `xtask` produces a binary named `xtask` and forces consumers to clone the repo. A dedicated binary crate is the idiomatic answer and is what `cargo-dist` is designed for.

```toml
# crates/pegana-replay-cli/Cargo.toml
[package]
name    = "pegana-replay-cli"
version = "0.1.0"
edition = "2021"
description = "Reproduce and verify a Pegana alert from its public receipt."
license     = "MIT"
repository  = "https://github.com/lrafasouza/pegana"

[[bin]]
name = "pegana-replay"
path = "src/main.rs"

[dependencies]
pegana-methodology = { path = "../methodology" }
clap               = { version = "4", features = ["derive"] }
reqwest            = { workspace = true }
serde              = { workspace = true }
serde_json         = { workspace = true }
tokio              = { workspace = true, features = ["rt", "macros"] }
anyhow             = { workspace = true }
similar            = "2"   # for diff output on FAIL
```

**Binary name**: `pegana-replay` (not `xtask`, not `pegana-replay-cli`).

**CLI surface** (clap derive):

```rust
#[derive(Parser)]
struct Cli {
    /// Alert UUID to verify by fetching from the API.
    #[arg(long, conflicts_with = "bundle")]
    alert_id: Option<Uuid>,

    /// Path to a local replay bundle JSON (for offline verification).
    #[arg(long, conflicts_with = "alert_id")]
    bundle: Option<PathBuf>,

    /// API base URL. Defaults to PEGANA_API env or https://api.pegana.xyz.
    #[arg(long, env = "PEGANA_API", default_value = "https://api.pegana.xyz")]
    api_url: Url,

    /// Suppress all output except final PASS/FAIL line.
    #[arg(long)]
    quiet: bool,
}
```

**Logic**: same as before — fetch or load bundle, version-check, recompute, compare, exit 0/1/2/3.

### 4.7a Public binary distribution via `cargo-dist`

Add to root `Cargo.toml`:

```toml
[workspace.metadata.dist]
cargo-dist-version    = "0.30.0"
ci                    = ["github"]
installers            = ["shell", "powershell", "homebrew"]
targets = [
  "x86_64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
]
hosting               = ["github"]
install-path          = "~/.pegana/bin"
publish-jobs          = []
# Sigstore-backed artifact attestations via GitHub's OIDC. Free, keyless,
# zero-config — every release artifact gets a cryptographic provenance
# record verifiable with `gh attestation verify`.
github-attestations   = true
```

**Verification flow for skeptics**:

```sh
# After install, verify the binary was built by the official CI
gh attestation verify ~/.pegana/bin/pegana-replay \
  --owner lrafasouza \
  --repo pegana
```

This proves the binary was produced by the GitHub Actions workflow on the canonical repo — no signing key management, no separate trust root.

**Hosting strategy for `releases.pegana.xyz`**:

1. CI publishes signed tarballs + install scripts to GitHub Releases (standard cargo-dist output).
2. `releases.pegana.xyz` is a Cloudflare CNAME or Caddy reverse proxy in front of `github.com/lrafasouza/pegana/releases/latest/download/`.
3. The install script URL becomes `https://releases.pegana.xyz/pegana-replay-installer.sh` (proxied to GitHub).

**End-user install** (one line, replaces "cargo install --git …"):

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://releases.pegana.xyz/pegana-replay-installer.sh | sh
```

Or for Mac users via Homebrew tap (cargo-dist generates a formula):

```sh
brew tap lrafasouza/pegana && brew install pegana-replay
```

Or via Cargo (for Rust devs):

```sh
cargo install pegana-replay-cli --version 0.1.0
```

**Signing**: cargo-dist supports Sigstore-style signing of release artifacts (`omnibor` integration is roadmap). For v0.1.0 we ship unsigned tarballs but with sha256 checksums in the release manifest — same baseline most Rust CLIs use today.

**Reproducibility verification**: the GitHub Release for `methodology-v0.1.0` lists the `methodology_git_sha` of the build. End users who want to verify the binary itself was built from the published source can `cargo install --git --tag` and compare hashes.

### 4.8 Changes to `mcp-ts`

Verified via reading `mcp-ts/src/tools/subscribe-peg-events.ts`. The current tool already returns BOTH:
- `content: [{ type: "text", text: JSON.stringify(structured) }]` — for LLM text consumption
- `structuredContent: { count, next_cursor, events: [...] }` — for structured client parsing

Both must be updated.

**`subscribe_peg_events`**:
- Extend Zod `alertEvent` schema:
  ```ts
  const alertEvent = z.object({
    id: z.string(),
    asset: z.string(),
    from_state: z.enum(PEG_STATES),
    to_state: z.enum(PEG_STATES),
    discount: z.string(),
    ts: z.number().int(),
    evidence_url: z.string().url().describe(
      "Public URL of the alert's audit receipt (inputs, methodology version, replay bundle download)."
    ),
  });
  ```
- The SQL query joins `alerts` (or the existing `alert_events` view, if that is what production uses) and constructs `evidence_url = '${AUDIT_BASE_URL}/audit/' || id`. Since the URL is a pure function of the alert ID, a SQL `concat` is fine.
- Add a paragraph to the tool `description` that references `evidence_url` so agents know it exists.

**`get_asset_state`**:
- If the tool surfaces the most recent alert (need to verify in the file), include `last_alert_evidence_url`.

**New free tool: `verify_alert({ alert_id })`**:
- Description: "Free. Fetches the public audit receipt for a given alert UUID. Returns the same JSON as `GET /v1/audit/:alert_id` — inputs frozen, methodology version, computed outputs, replay bundle URL."
- Input schema: `{ alert_id: z.string().uuid() }`.
- Output schema mirrors the `/v1/audit/:alert_id` JSON response.
- Handler proxies to the API (no database access from the MCP for this tool; the API is the source of truth).
- Annotations: `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false`.

**Backward compatibility**: adding fields is additive. Existing MCP clients that don't know about `evidence_url` ignore unknown fields per MCP spec (JSON-RPC + JSON Schema permissive behavior). Test plan covers this.

### 4.9 Changes to `bot-ts`

Verified via reading `bot-ts/src/index.ts:1113` — the `/send` handler's Zod schema is:

```ts
vars: z.record(z.string(), z.unknown()).default({})
```

This already accepts arbitrary keys. **No Zod schema change needed in the bot.** Only the locale files and the alert templates change.

- `locales/en.ftl`: each of `alert_lst`, `alert_cdp`, `alert_fx`, `alert_yield`, `alert_stable` gets a trailing line:
  ```
  🔍 Evidence: <a href="{ $evidenceUrl }">{ $alertId }</a>
  ```
  (HTML mode is already in use per the locale file header; the link wraps the short alert id for legibility.)
- `locales/pt-BR.ftl`: same, localized as `🔍 Evidência: <a href="{ $evidenceUrl }">{ $alertId }</a>`.
- `src/index.ts::renderAlertTemplate`: no code change beyond passing through the new `vars` keys; Fluent reads whatever's in the context.
- Add `alertId` to the dispatcher's `vars` payload alongside `evidenceUrl` — Fluent needs both to render the anchor text.

**Validation**: existing alert message length stays comfortably under Telegram's 4096-char limit (current templates are ~400 chars; adding one anchored line adds ~80 chars).

### 4.10 New web page

- `web/app/audit/[alert_id]/page.tsx` — server component, no auth, indexable.
- **Routing decision**: placed at the top level (`app/audit/...`), not under the `(app)` group (which has authenticated routes) nor under `(marketing)` (which carries marketing-style branding). The audit surface is its own thing: public, factual, proof-style.
- Uses Next.js 16 App Router conventions verified against `node_modules/next/dist/docs/` before implementation (per project AGENTS.md rule). The dynamic segment is `[alert_id]`.
- `web/app/audit/[alert_id]/loading.tsx` — minimal skeleton while the API call resolves.
- `web/app/audit/[alert_id]/not-found.tsx` — explicit 404 when the API returns `evidence_missing`.
- `web/app/audit/page.tsx` (optional, fase 0): index page listing recent audited alerts. Could be a follow-up.
- Sections rendered:
  1. **Header** — asset symbol, class badge, state transition (`PEGGED → DRIFT`), `detected_at` timestamp.
  2. **Inputs** — table of `intrinsic_usd`, `market_usd`, (LST: `intrinsic_sol`, `market_sol`), `ewma_prev`, every Pyth entry with `price ± confidence` and `publish_time` (with humanized "as of N seconds ago").
  3. **Computed** — `discount_raw`, `discount_smooth`, `final_state`, `confidence_label`.
  4. **Methodology** — `version`, `git_sha` (linking to the GitHub commit), `assets_toml_sha256` (linking to the GitHub blob view of `assets.toml` at that hash).
  5. **Replay** — "Download replay bundle" button (`/v1/audit/:alert_id/replay-bundle`), `pegana-replay --bundle ./alert-<id>.json` command, link to "How to verify" page.
  6. **Footer** — link to methodology versioning changelog (`/methodology#changelog`), link to the spec doc.
- The `/methodology` page mentioned in old screenshots does NOT currently exist in `web/app` (verified by `find` 2026-05-28). It is created fresh in Section 4.14.

### 4.11 Methodology lifecycle (status field)

Bugs in methodology versions are inevitable. The audit story must handle them without invalidating past receipts.

**New table**: `methodology_versions` (managed by hand at first; future PR review process below).

```sql
CREATE TABLE methodology_versions (
    version       TEXT        PRIMARY KEY,   -- "0.1.0"
    git_tag       TEXT        NOT NULL,      -- "methodology-v0.1.0"
    released_at   TIMESTAMPTZ NOT NULL,
    status        TEXT        NOT NULL CHECK (status IN ('active', 'deprecated', 'broken')),
    status_reason TEXT,                       -- "Off-by-one in EWMA when prev=None" etc.
    superseded_by TEXT REFERENCES methodology_versions(version),
    notes         TEXT
);
```

**Engine behavior**: at startup, the engine reads its own `methodology_version()` and queries this table. If `status = 'broken'` for its own version, it logs `error!` + bumps `pegana_engine_methodology_broken_total` and refuses to start (operator must roll forward to a fixed version).

**Audit page behavior**: `/audit/[id]` queries `methodology_versions` for the receipt's version. If `status != 'active'`, renders a prominent banner:

> ⚠️ This alert was generated by **methodology v0.1.0**, which is now marked **broken**: "Off-by-one in EWMA when prev is None for cold-started assets." See [changelog](/methodology#changelog). The replay can still be verified, but the alert's accuracy should not be trusted in production decision-making.

**Process for marking a version broken**:
1. Bug confirmed via regression test in `crates/methodology/tests/`.
2. PR updates the row: `UPDATE methodology_versions SET status='broken', status_reason=..., superseded_by='0.1.1' WHERE version='0.1.0';`. (Manual SQL is fine for solo founder; codify into a migration if a 2nd contributor joins.)
3. Engine is rolled forward to the fixed version in the same PR.

**Storage cost**: trivial — one row per version (expected ~10 versions/year for many years).

### 4.12 `/audit` index page

Without an index, audit URLs are only discoverable via Telegram/webhook/MCP responses. For external skeptics and journalists, an index closes the discovery gap.

- `web/app/audit/page.tsx` — server component listing the last 50 audited alerts where `to_state != 'PEGGED'` (i.e., the interesting ones).
- Columns: timestamp, asset, transition, methodology version, link to `/audit/[id]`.
- Filter by methodology version (especially useful for "show me all alerts emitted by v0.1.0").
- No pagination beyond 50 — that's enough for "browse what's interesting recently"; for full history, link to `/v1/alerts?from=...&to=...` API.

**SQL behind the index**:

```sql
SELECT a.id, a.asset, a.from_state, a.to_state, a.detected_at,
       e.methodology_version, e.receipt_sha256
FROM alerts a
JOIN alert_evidence e ON e.alert_id = a.id
WHERE a.to_state <> 'PEGGED'
ORDER BY a.detected_at DESC
LIMIT 50;
```

**Cache**: 60-second SWR — fresh enough for "recent" without hitting Postgres on every request.

### 4.13 OG image generation per audit

Telegram, Twitter, and Discord all unfurl URLs by fetching `og:image`. A receipt URL with a default OG image is just text in the unfurl preview; with a generated image, it becomes a credibility statement.

- `web/app/audit/[alert_id]/opengraph-image.tsx` (Next.js 16 file convention, validated via context7).
- Renders a 1200×630 PNG with:
  - Asset symbol (large)
  - Transition badge (`PEGGED → CRITICAL`)
  - Methodology version
  - First 12 chars of receipt sha256 (proof of uniqueness)
  - Pegana brand mark (small, bottom-right)
- Static-generated at build time when possible; for very fresh alerts (last 1h), generated on-demand via `next/og` `ImageResponse`.
- Uses the existing `web/assets/` font (load via `readFile` per context7 example).
- One JSX file, ~50 lines.

**Why this matters more than it sounds**: a Twitter share of `https://pegana.xyz/audit/[uuid]` becomes a one-glance proof card. For pitching protocol integrations, journalists, and ecosystem partners, that's the difference between "PR link nobody clicks" and "credibility carrier."

### 4.14 `/methodology` web page (fresh build)

- `web/app/methodology/page.tsx` — public, indexable, server component.
- Sections:
  1. **What this is** — short paragraph: deterministic function over `(intrinsic, market, thresholds, methodology_version)`.
  2. **How to verify any alert** — install one-liner + `pegana-replay --alert-id <id>` snippet.
  3. **Versions table** — rendered from `crates/methodology/CHANGELOG.md` (read at build time). Each row links to the GitHub commit tagged `methodology-v<x.y.z>`.
  4. **Lifecycle states** — explains `active`, `deprecated`, `broken` semantics so readers of a broken-version banner know what it means.
  5. **What this audit ISN'T** — explicit disclaimer: not SOC 2, not regulatory audit, not financial advice. Just verifiable computation log.
  6. **Source** — link to `https://github.com/lrafasouza/pegana/tree/main/crates/methodology`.

**Placement**: top-level (`web/app/methodology/page.tsx`), not under `(app)` or `(marketing)` — symmetric with `/audit`.

### 4.15 On-chain receipt commitment (Solana SPL Memo)

Trust Layer becomes **cryptographically anchored** when every critical alert's `receipt_sha256` is committed on-chain via the Solana SPL Memo program. Skeptics can verify the receipt existed at a specific block height — Pegana cannot retroactively forge timestamps.

**Why memo program (not custom program)**:
- Battle-tested, audited, immutable program ID
- Zero deploy/maintenance cost
- 5000 lamports per signature ≈ **$0.0005 per memo at $100/SOL**
- For ~50 critical alerts/month = **~$0.025/month** — operationally trivial
- Logs visible in any Solana explorer (Solscan, Solana Explorer)

**Program ID**: `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` (canonical SPL Memo v2).

**Engine wallet**:
- New env: `PEGANA_COMMIT_KEYPAIR` (base58 secret key or path to JSON keyfile)
- Funded with ~$5 SOL covers ~10 years at current rates
- Public key documented at `/methodology#on-chain-anchor` so anyone can filter `getSignaturesForAddress` to find all Pegana commits

**Memo payload format**:
```
pegana-v1|{methodology_version}|{alert_id}|{receipt_sha256}
```
Example:
```
pegana-v1|0.1.0|550e8400-e29b-41d4-a716-446655440000|abc123def456...
```

Total: ~100 chars (well under memo's compute budget).

**Engine integration** (`crates/engine-rs`):
- New dep: `spl-memo = "4"`
- New module: `src/onchain_commit.rs` — async fn `commit_receipt(rpc, keypair, alert_id, receipt_sha256, version)`
- Called from `push_alert` AFTER the `alert_evidence` row is persisted, but in a `tokio::spawn` (fire-and-forget — failure is logged + counted, never blocks alert dispatch)
- New column on `alert_evidence`: `onchain_tx_sig TEXT` (NULL until confirmed)
- Background job updates the column with the signature once `send_and_confirm` returns

**New API endpoint**:
- `GET /v1/audit/:alert_id/onchain` → returns `{ tx_sig, block_time, explorer_url }` if committed, else `404 not_committed_yet`

**Web audit page**:
- New section "On-chain commitment" with link to Solana Explorer + block time
- Renders only when `onchain_tx_sig` is non-null

**Replay CLI**:
- New flag: `--verify-onchain` — additionally queries Solana RPC, confirms memo exists, checks the in-memo sha256 matches the bundle's receipt hash
- Exit code 4: ONCHAIN_MISMATCH

**Failure modes**:
- RPC unavailable: log + counter, retry exponential backoff up to 1h
- Wallet out of funds: bump counter `pegana_commit_wallet_low_balance` + Sentry alert
- Transaction simulation fails: log payload + reason
- Memo deduplication: alerts already committed (idempotency via `alert_evidence.onchain_tx_sig != NULL` check) are skipped

### 4.16 RSS/Atom audit feed (`/audit.xml`)

**Why**: journalists, researchers, automated monitoring tools subscribe to RSS but won't poll an API. An Atom 1.0 feed of recent audits is zero-friction syndication.

**Implementation** (`web/app/audit.xml/route.ts` — Next.js Route Handler):

```typescript
import { Feed } from "feed";

export const revalidate = 60;

export async function GET() {
  const apiBase = process.env.PEGANA_API ?? "https://api.pegana.xyz";
  const audits = await fetch(`${apiBase}/v1/audit?limit=50&exclude_pegged=true`).then(r => r.json());

  const feed = new Feed({
    title: "Pegana — Recent Audits",
    description: "Verifiable peg-risk alerts from Pegana",
    id: "https://pegana.xyz/audit",
    link: "https://pegana.xyz/audit",
    language: "en",
    favicon: "https://pegana.xyz/favicon.ico",
    copyright: `© ${new Date().getFullYear()} Pegana`,
    feedLinks: { atom: "https://pegana.xyz/audit.xml" },
  });

  for (const a of audits) {
    feed.addItem({
      title: `${a.asset}: ${a.from_state} → ${a.to_state}`,
      id: `https://pegana.xyz/audit/${a.id}`,
      link: `https://pegana.xyz/audit/${a.id}`,
      description: `Methodology v${a.methodology_version}. Receipt: ${a.receipt_sha256.slice(0,16)}…`,
      date: new Date(a.detected_at),
    });
  }

  return new Response(feed.atom1(), {
    headers: { "Content-Type": "application/atom+xml; charset=utf-8" },
  });
}
```

Dep: `npm install feed` (top of weekly downloads for Atom feed generation in TS).

**Discovery**:
- `<link rel="alternate" type="application/atom+xml" href="/audit.xml">` in root layout `<head>`
- Listed on `/audit` page footer as "Subscribe to feed"

### 4.17 Embed widget (badge for partners)

**Goal**: Kamino, Drift, Jupiter Lend can display a live "USDe peg state by Pegana" badge on their own dashboards. Two integration paths offered:

#### Path A — Script tag (recommended for partners with CMS access)

```html
<div data-pegana-asset="USDe"></div>
<script async src="https://pegana.xyz/embed.js"></script>
```

The script:
- Loads ~6 KB minified + gzipped
- No external deps (no React, no jQuery)
- Polls `/v1/assets/USDe` every 30s
- Renders a 200×40 badge inline:
  ```
  [USDe] ● PEGGED  Pegana ↗
  ```
- Click opens `/audit?asset=USDe` in a new tab
- Color codes: green=PEGGED, yellow=DRIFT, orange=DEPEG, red=CRITICAL/BLACK_SWAN
- `postMessage` events emit state changes to host page

**Source**: `web/public/embed.js` — vanilla TS compiled to ES2020, ~150 lines.

#### Path B — Iframe (recommended for security-conscious sites)

```html
<iframe src="https://pegana.xyz/embed/USDe" width="240" height="48" frameborder="0"></iframe>
```

- Server-rendered page at `web/app/embed/[asset]/page.tsx`
- Same visual as script badge
- Sandboxed by browser — host site has zero access to its DOM/cookies/JS context

**CORS**: API responds with `Access-Control-Allow-Origin: *` only for the `/v1/assets/*` endpoint (read-only data). Audit endpoints are not exposed cross-origin (CSRF safety).

**Themes**: `?theme=dark` query param on iframe URL or `data-pegana-theme="dark"` attribute on script-target div.

**Acceptance**: live demo at `/embed/demo` showing the badge rendered against real assets, plus copy-paste integration snippets for Kamino, Drift, MarginFi style guides.

### 4.18 CSV export (`/v1/audit.csv`)

**Why**: analysts, researchers, compliance teams pull bulk data in CSV. Forcing them to write a JSON-to-CSV converter is friction.

**Endpoint**: `GET /v1/audit.csv?from=2026-01-01&to=2026-06-30&asset=USDe`

**Implementation** (`crates/api-rs/src/routes/audit.rs`):

- Dep: `axum-streams = "0.x"` (provides `StreamBodyAsCsv`)
- Streams via chunked transfer encoding — never loads full dataset into memory
- Cursor-based: uses `LIMIT 1000` + `WHERE detected_at < $cursor` pattern with auto-pagination internally
- Headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="pegana-audits-{from}-{to}.csv"`

**Columns** (in order):
```
alert_id,asset,class,from_state,to_state,discount,intrinsic_usd,market_usd,confidence,
detected_at,methodology_version,assets_toml_sha256,receipt_sha256,onchain_tx_sig
```

**Limits**:
- Max date range: 1 year per request (to avoid runaway)
- Anonymous: 10 req/hour (`/v1/audit.csv` only)
- No paginated CSV — use repeated calls with date filter for >1y ranges

**Test**: `crates/api-rs/tests/audit_csv.rs` — assert streaming behavior with 10k synthesized rows under 100 MB memory.

### 4.19 Auto-generated SDKs (TypeScript + Python)

**Goal**: developers integrating Pegana programmatically (analysts, partner protocols, ecosystem builders) get a typed client without writing one.

**Source of truth**: utoipa-generated OpenAPI spec already exposed by `api-rs` at `/openapi.json`.

**Tooling**: `@openapitools/openapi-generator-cli` v7.22.0 (active development, 23k context7 snippets).

**Generators used**:
- `typescript-fetch` → `@pegana/sdk-ts` published to npm
- `python` (pydantic v2 mode) → `pegana-sdk` published to PyPI

**CI workflow** (`.github/workflows/sdk-release.yml`):

```yaml
name: Generate and publish SDKs
on:
  workflow_dispatch:
  push:
    tags: ["sdk-v*"]
jobs:
  generate-and-publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: '22' }
      - run: npm install -g @openapitools/openapi-generator-cli@7.22.0
      - name: Fetch live OpenAPI spec
        run: curl -o /tmp/openapi.json https://api.pegana.xyz/openapi.json
      - name: Generate TypeScript SDK
        run: |
          openapi-generator-cli generate \
            -i /tmp/openapi.json \
            -g typescript-fetch \
            -o sdk/typescript \
            --additional-properties npmName=@pegana/sdk-ts,supportsES6=true
      - name: Generate Python SDK
        run: |
          openapi-generator-cli generate \
            -i /tmp/openapi.json \
            -g python \
            -o sdk/python \
            --additional-properties packageName=pegana_sdk,projectName=pegana-sdk
      - name: Publish TS SDK to npm
        env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} }
        working-directory: sdk/typescript
        run: npm install && npm run build && npm publish --access public
      - name: Publish Python SDK to PyPI
        env: { TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }} }
        working-directory: sdk/python
        run: pip install build twine && python -m build && python -m twine upload dist/*
```

**Release cadence**: tag `sdk-v<x.y.z>` triggers. Patch bumps follow API additions; major bumps follow breaking changes.

**Usage** (in `/methodology` page docs):
```ts
import { AuditApi } from "@pegana/sdk-ts";
const api = new AuditApi();
const receipt = await api.getAudit({ alertId: "..." });
```
```python
from pegana_sdk import AuditApi
api = AuditApi()
receipt = api.get_audit(alert_id="...")
```

### 4.20 Calibration changes feed (`/calibration.xml`)

Mirror of `/audit.xml` but for **threshold/asset config changes**, not alerts.

**Source**: git log of `assets.toml` filtered to lines that change a `thresholds_bps`, `thresholds_cr`, or asset entry add/remove.

**Implementation** (`web/app/calibration.xml/route.ts`):

- Server reads `git log --follow assets.toml -p -n 100` at build time (via Next.js `revalidate` 1h)
- Parses diff hunks; for each commit touching a threshold or asset row, emits a feed item
- Each item: `Calibration: USDe drift 50 → 80 bps · methodology v0.1.0` with commit SHA + author + GitHub link

**Why this matters for trust**:
- Customers can subscribe and see when Pegana changed any threshold
- Demonstrates that calibration is git-tracked (transparent)
- Surfaces "the day USDe was added" or "the day jitoSOL threshold was tuned"

**Format**: Atom 1.0 (same `feed` lib as `/audit.xml`).

### 4.21 Reproducible builds

**Goal**: anyone with the source code + the published Cargo.lock can rebuild the engine binary and verify it matches the running container.

**Rust-side**:
- `cargo build --locked --frozen` enforced in CI release job
- `Cargo.lock` already committed (verify)
- `rust-toolchain.toml` already pins `1.90` (verify in repo)

**Docker-side**:
- Pin base image by digest, not tag:
  ```dockerfile
  FROM rust:1.90.0-slim-bookworm@sha256:abc123... AS builder
  ```
- Pin system packages with explicit versions in `apt-get install`
- Pin `bun` and `node` versions in TS service Dockerfiles by digest

**CI verification** (`.github/workflows/reproducible.yml`):

```yaml
name: Reproducible build verification
on:
  pull_request:
  push: { branches: [main] }
jobs:
  build-twice-compare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Build engine first time
        run: cargo build --release --locked --frozen -p pegana-engine
      - name: Capture binary hash
        run: sha256sum target/release/pegana-engine > /tmp/hash-1
      - name: Clean and rebuild
        run: cargo clean && cargo build --release --locked --frozen -p pegana-engine
      - name: Compare
        run: |
          sha256sum target/release/pegana-engine > /tmp/hash-2
          diff /tmp/hash-1 /tmp/hash-2 || { echo "Build is not reproducible!"; exit 1; }
```

**Publication**: every Docker image tag is published with its source git SHA, Cargo.lock hash, and binary sha256 listed at `/methodology#binary-checksums`. Auditors can `cargo build --locked` + Docker build, compare.

**Note**: full bit-for-bit reproducibility across machines/architectures requires more (e.g., SOURCE_DATE_EPOCH, stripped timestamps). v0.1.0 target: same-machine determinism (rebuild on same CI runner produces same hash). v0.2.0: cross-runner.

---

## 5. Methodology versioning

- The `methodology` crate has its own `Cargo.toml` with an independent semver. It starts at `0.1.0` at the moment this spec ships.
- Any change inside `crates/methodology/src/` requires bumping the version in the same PR. A CI check enforces this: if the diff touches `crates/methodology/src/` but does not touch `crates/methodology/Cargo.toml`'s `version` line, the check fails.
- Bump rules:
  - **Patch**: refactor without observable behavior change. (Receipt hash will still change due to versioning bookkeeping in the receipt, but `expected_computed` should be identical for the same `inputs_frozen`.)
  - **Minor**: new pure function added, no existing function changes output.
  - **Major**: any existing function changes output for some input.
- Each version gets a git tag `methodology-v<x.y.z>` for `cargo install --git ... --tag` reproducibility.
- The `/methodology` web page renders a changelog table from `crates/methodology/CHANGELOG.md`.
- `methodology_git_sha` in receipts is set via the Docker build arg `PEGANA_GIT_SHA=<sha>`. Without the arg, `option_env!` returns `None` and the field is `null` in the receipt; the CLI tolerates this for local dev but warns "this alert was generated by a dev build; reproducibility not guaranteed."

---

## 6. Replay path (third-party verification)

1. **A skeptic reads an alert** on Telegram, on the web, or in a webhook payload. The message includes `🔍 https://pegana.xyz/audit/<id>`.
2. **They open the link.** The web page shows everything that went into the decision.
3. **They want to verify independently.** Two options:
   - **In-browser**: read the receipt, manually walk the math against the methodology page.
   - **Programmatically**: run the CLI.
4. **CLI flow** (zero Rust toolchain required for end users):
   ```bash
   # Install (one-time, any shell on macOS/Linux)
   curl --proto '=https' --tlsv1.2 -LsSf \
     https://releases.pegana.xyz/pegana-replay-installer.sh | sh

   # Or with Homebrew
   brew tap lrafasouza/pegana && brew install pegana-replay

   # Or with Cargo (for Rust devs who want to verify from source)
   cargo install pegana-replay-cli --version 0.1.0

   # Verify a live alert
   pegana-replay --alert-id <UUID>

   # Or offline (no network after the initial bundle download)
   curl -o bundle.json https://api.pegana.xyz/v1/audit/<UUID>/replay-bundle
   pegana-replay --bundle ./bundle.json
   ```
5. **Output**:
   ```
   ✓ PASS  USDe  DRIFT → DEPEG  @ 2026-05-28T14:33:12Z
            methodology v0.1.0, assets_toml sha256:abc1234...
            recomputed receipt:abc987... matches stored receipt:abc987...
   ```
   Or:
   ```
   ✗ FAIL  USDe  DRIFT → DEPEG  @ 2026-05-28T14:33:12Z
            expected final_state=DEPEG  recomputed final_state=DRIFT
            expected discount_smooth=0.0218  recomputed discount_smooth=0.0145
   ```

This is the contract: anyone, anywhere, with the published receipt and the matching methodology version, gets PASS. If they get FAIL, Pegana has a bug or the data has been altered — both are findable.

---

## 7. Backtest 2025-10-10 as published artifact

- New directory `docs/backtests/2025-10-10-usde-depeg/`.
- Contents:
  - `inputs.json` — historical Pyth Hermes pulls for `USDe/USD` and `sUSDe/USDe.RR` from Oct 9 to Oct 12, 2025.
  - `assets-snapshot.toml` — hypothetical `assets.toml` entry for USDe with the standard `stable_yield` thresholds (`drift=50`, `depeg=200`, `critical=500`).
  - `methodology-output.json` — the result of running the current methodology against the inputs.
  - `README.md` — narrative: timeline of state transitions Pegana would have emitted, chart of discount vs threshold bands, comparison vs the actual cascade on Binance.
- New script `scripts/run-backtest.sh <backtest-id>` reproduces the run. Reads the fixture, calls the methodology, diffs against the committed output.
- Wired into CI: the script runs on every PR. If methodology changes cause the output to diverge from the committed `methodology-output.json`, CI fails. Updating the output requires explicit commit (which makes the methodology change visible in the PR diff).
- **Labeled clearly**: the published markdown says "Hypothetical backtest. No real alert was emitted on this date. This artifact shows what Pegana would have emitted given the same inputs."
- This backtest is the public proof of concept for sub-projects B+ that will add USDe to live monitoring.

---

## 8. Error handling

- **`methodology` crate**: functions return concrete types where math is total (most cases). The only fallible function is `canonical_assets_hash`, which returns `Result<[u8; 32], MethodologyError>` (errors: unparseable TOML, write failure). The receipt hash function is total.
- **Engine `push_alert`**: writes the `alert_evidence` row inside the same `sqlx::query` chain as the existing `alerts` insert. If the `alerts` insert succeeds and the `alert_evidence` insert fails:
  - Log error at `error` level.
  - Increment `pegana_audit_persist_failed_total` counter (label: asset, transition).
  - **Do not fail the alert dispatch.** Alerts have higher priority than evidence; better to deliver an alert without evidence than to drop the alert. Operational dashboards flag the inconsistency.
- **API `GET /v1/audit/:alert_id`**:
  - `200 OK` with the receipt JSON.
  - `404 Not Found` if the `alert_id` does not exist in `alerts`.
  - `404 Not Found` (with a distinct error body `{"error": "evidence_missing", "alert_id": "..."}`) if `alerts` row exists but `alert_evidence` row is missing. Operators can grep for this body to find unrecoverable past failures.
- **CLI exit codes**:
  - `0` — PASS.
  - `1` — FAIL (computed values or receipt hash differ).
  - `2` — ERROR (network failure, malformed bundle, unknown alert).
  - `3` — VERSION_MISMATCH (methodology version of CLI ≠ alert's recorded version).

---

## 9. Testing strategy

- **`methodology` crate**: 100% line coverage on every public function. Property tests use the `proptest` crate:
  - `apply_ewma_pure`: at α=0, result equals `prev`; at α=1, result equals `raw`; output is bounded between `min(raw, prev)` and `max(raw, prev)`.
  - `transition_decide`: across all (current × candidate × time-elapsed) combinations, the decision matches a hand-derived truth table.
  - `state_for_*_discount*`, `state_for_cr`: existing 8 tests move from `thresholds.rs`, plus boundary tests at every threshold value.
- **Engine refactor**:
  - Existing integration tests in `state.rs` (5 tests, including `lst_discount_in_sol_terms_ignores_sol_usd_multiplier_drift` and `per_feed_staleness_override_widens_window`) must continue to pass after the refactor.
  - New test: `engine_transition_takes_explicit_now_argument` — confirms `transition` no longer reads the clock internally.
- **Audit persistence**:
  - New integration test in `crates/engine-rs/tests/audit_persistence.rs` — spins up an ephemeral Postgres via sqlx, runs a synthetic recompute pipeline, asserts that `alerts` and `alert_evidence` rows are both written with consistent IDs.
- **Append-only trigger**:
  - New Rust test `crates/engine-rs/tests/alert_evidence_append_only.rs` — using sqlx against ephemeral Postgres, inserts a row, attempts `UPDATE` and `DELETE`, asserts both raise the `raise_exception` PL/pgSQL error (SQLSTATE `P0001`).
- **API audit endpoint**:
  - New `crates/api-rs/tests/audit_endpoint.rs` — covers `200`, `404 alert missing`, `404 evidence_missing`.
- **Replay CLI**:
  - New `crates/pegana-replay-cli/tests/replay.rs` — generates a synthetic receipt via the methodology, runs the CLI binary against it, asserts PASS.
  - Tamper test: alter `inputs_frozen.market_usd` by one cent in the bundle, run CLI, assert FAIL with a diff message that includes the changed field.
- **Backtest regression**:
  - `scripts/run-backtest.sh 2025-10-10-usde-depeg` runs on every PR via CI. Diverging output fails the build.

---

## 10. Operational concerns

- **Migration safety**: `0028_alert_evidence.sql` only adds a new table; no schema changes to existing tables. Rollback = `DROP TABLE alert_evidence; DROP FUNCTION alert_evidence_immutable() CASCADE;`. Safe to ship in a single deploy.
- **Storage growth**: at the current alert rate (~50 critical/month, ~500 drift/month), the table grows ~5 MB/year worst case. No retention policy needed for now. Re-evaluate at 1 GB.
- **Backups**: existing pg_dump in `ops/` already covers all tables. No new backup work.
- **Observability**: 3 new Prometheus metrics:
  - `pegana_audit_persist_total{outcome="ok|failed"}` — counter.
  - `pegana_audit_persist_duration_seconds` — histogram.
  - `pegana_audit_replay_artifact_size_bytes` — histogram (to detect runaway artifact sizes).
- **Pre-flight (must complete before any deploy)**:
  1. **Confirm `alert_events` view exists on production Postgres.** Run `psql $PROD_DATABASE_URL -c "\d alert_events"`. If the view does not exist, MCP `subscribe_peg_events` is currently broken in prod — fix via migration `0029` first, validate MCP recovers, then proceed.
  2. **Confirm USDe + JLP entries are in `assets.toml` with `active=false`** for at least 14 days of passive calibration (Phase 0 of plan). Calibration histogram exported via `pegana_engine_discount_raw_bucket` for those symbols.
  3. **Confirm Grafana dashboard panels for `pegana_audit_persist_total{outcome="failed"}` are imported** and alert routing is set up.
- **Deploy order**:
  1. Apply migrations `0028` (`alert_evidence`) and `0029` (`alert_events` view) — in that order, single transaction.
  2. Insert seed row in `methodology_versions` for `0.1.0` with `status='active'`.
  3. Ship the `methodology` crate + engine refactor + api-rs changes in one Docker build. The `pegana-replay-cli` binary releases to GitHub/`releases.pegana.xyz` via the cargo-dist CI workflow on the same commit (separate job, same tag). Sigstore attestations attached automatically.
  4. Ship `dispatcher-rs` change to include `evidence_url` (web `/audit` page must exist in prod before this is enabled — order matters or users get broken links).
  5. Ship `bot-ts` locale update and `mcp-ts` tool changes (these read `evidenceUrl` if present; no-op if absent, so order is flexible after step 4).
  6. Flip USDe + JLP `active=true` in `assets.toml`; restart engine.
  7. Publish the 2025-10-10 backtest artifact to the web (Phase 14 of plan, separate PR).

---

## 11. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Engine refactor breaks an existing alert path | Medium | High | All 5 existing integration tests in `state.rs` must pass unchanged. Add the new test that asserts explicit-`now` behavior matches old implicit-`now`. |
| Receipt hash divergence between engine and CLI on the same inputs | Low | Critical | Both call the exact same `methodology::canonical_receipt_hash`. CI runs the synthetic-receipt roundtrip test on every commit. |
| `replay_artifact` accidentally captures sensitive data (API keys, RPC URLs) | Low | Medium | The artifact only contains inputs already present in `inputs_frozen` + the canonical `assets.toml`. No env vars, no DB credentials, no RPC endpoints flow into the methodology layer. |
| `assets.toml` is rewritten with the same semantic content but different formatting → hash changes → past alerts look "broken" | Medium | Medium | The hash is over the canonicalized form (sorted keys, no comments, normalized whitespace). Hand-edits that preserve semantics keep the hash stable. |
| A critical alert fires but `alert_evidence` insert fails silently | Low | High | Counter `pegana_audit_persist_failed_total` is alerted at > 0 on the operational dashboard. Sentry (already wired per `bot-ts/package.json` and engine-rs Cargo.toml) captures the exception with full context. Any failure is investigated within the same business day. |
| Methodology version mismatch in the CLI confuses users | Medium | Low | The CLI prints the exact `cargo install ... --tag` command needed when version mismatch is detected, plus the `releases.pegana.xyz` installer URL pinned to the right version. Documented on the `/methodology` web page. |
| `alert_events` is referenced by MCP and scripts but is not defined in any migration — likely a view created out-of-band on production | High | Medium | **Action before implementation**: confirm whether `alert_events` exists on prod (likely a view over `alerts`); if confirmed, add a migration `0029_alert_events_view.sql` codifying it. The audit endpoint queries `alerts` directly (FK target) regardless. |
| Receipt hash differs across architectures due to float rounding in canonical JSON encoding | Low | Critical | The methodology serializes `Decimal` as a string (not as JSON number), bypassing IEEE 754 ambiguity. `serde_json_canonicalizer` is RFC 8785-compliant and tested across x86_64 and aarch64 in CI. |
| End user installs CLI from `releases.pegana.xyz` but the proxy returns a stale or wrong binary | Low | High | The release manifest at `releases.pegana.xyz/dist-manifest.json` includes per-file sha256. The installer script verifies the checksum before executing the binary. Pegana publishes the expected sha256 of each release on the `/methodology#releases` web page. |

---

## 12. Acceptance criteria

This sub-project is complete when:

1. ✅ `crates/methodology` exists, compiles, has 100% test coverage on its public API.
2. ✅ `crates/engine-rs/src/thresholds.rs` is deleted; engine imports from `pegana_methodology::*`.
3. ✅ Engine refactor: `transition` takes explicit `now`. All 5 existing integration tests pass without modification.
4. ✅ Migration `0028_alert_evidence.sql` is applied. Trigger blocks `UPDATE` and `DELETE` (tested).
5. ✅ Every new alert emitted in production produces exactly one matching `alert_evidence` row. Failure to persist evidence is recorded in `pegana_audit_persist_failed_total` and **does not** abort the alert dispatch (see Section 8). Production target: ≥ 99.9% of alerts have matching evidence rows.
6. ✅ `GET /v1/audit/:alert_id` returns the receipt for any alert from the last 90 days. `GET /v1/audit/:alert_id/replay-bundle` returns the artifact for critical alerts.
7. ✅ Telegram alerts include `🔍 Evidence: https://pegana.xyz/audit/<id>` in PT-BR and EN.
8. ✅ Webhook payloads include `evidence_url`. Existing HMAC signing covers the field.
9. ✅ MCP `subscribe_peg_events` and the new `verify_alert` tool include `evidence_url`.
10. ✅ `pegana-replay --alert-id <recent-uuid>` (installed via `curl https://releases.pegana.xyz/pegana-replay-installer.sh | sh`) exits 0 for a real production alert on macOS arm64, macOS x64, Linux x64, and Windows x64. Tamper test exits 1 with a useful diff.
11. ✅ `/audit/[alert_id]` web page renders the full receipt for any production alert.
12. ✅ The 2025-10-10 USDe backtest is published at `docs/backtests/2025-10-10-usde-depeg/README.md` and runs in CI on every PR.
13. ✅ The `/methodology` web page is created fresh (does not exist today) and documents `methodology v0.1.0` with a changelog stub + lifecycle explanation + disclaimer.
14. ✅ USDe and JLP entries are present in `assets.toml`, calibrated for 14 days, and active in production at ship time.
15. ✅ `methodology_versions` table seeded with `0.1.0 active`; engine refuses to start if its own version is marked `broken`.
16. ✅ `/audit` index page lists the 50 most recent non-PEGGED alerts with methodology version filter.
17. ✅ Every `/audit/[id]` produces a 1200×630 PNG OG image via `opengraph-image.tsx` — verified by social card validators (cards-dev.twitter.com, Telegram link preview).
18. ✅ Binary releases include Sigstore-backed GitHub attestations; `gh attestation verify pegana-replay --owner lrafasouza --repo pegana` returns success.
19. ✅ `/v1/audit/:alert_id` and `/replay-bundle` return `Cache-Control: public, max-age=31536000, immutable`.
20. ✅ Pre-flight confirms `alert_events` view exists on production (or migration 0029 fixed it).
21. ✅ Every critical alert (`DEPEG`/`CRITICAL`/`BLACK_SWAN`) is committed on-chain via Solana SPL Memo within 60s; `alert_evidence.onchain_tx_sig` populated. Engine wallet maintains ≥ 0.5 SOL balance.
22. ✅ `/audit.xml` returns valid Atom 1.0 (passes [feedvalidator.org](https://feedvalidator.org)) with the 50 most recent non-PEGGED audits.
23. ✅ Embed badge: `<div data-pegana-asset="USDe"></div><script async src="https://pegana.xyz/embed.js"></script>` renders a live status badge in Chrome, Firefox, Safari; iframe variant at `/embed/USDe` works in a sandboxed `<iframe>`.
24. ✅ `GET /v1/audit.csv?from=2026-05-01&to=2026-05-31` streams a CSV with the documented columns; tested under 100 MB memory with 10k synthetic rows.
25. ✅ `@pegana/sdk-ts` published on npm with version matching the API version; `pegana-sdk` published on PyPI; both importable in a minimal demo project and round-trip `getAudit(alertId)` against prod.
26. ✅ `/calibration.xml` returns Atom feed of the last 100 `assets.toml` mutations (git log derived).
27. ✅ `cargo build --release --locked --frozen -p pegana-engine` is bit-for-bit reproducible on the same CI runner (verified by `.github/workflows/reproducible.yml` on every PR). Docker base images pinned by `@sha256:...` digest.
28. ✅ Replay CLI `--verify-onchain` flag confirms the on-chain memo exists and matches the bundle's `receipt_sha256`; exit code 4 on mismatch.

---

## 13. Open questions for user validation

**All resolved after validation pass on 2026-05-28**:

- (i) `methodology` crate semver: **`0.1.0`** — no compatibility commitment yet.
- (ii) Audit page URL pattern: **`/audit/[alert_id]`** — explicit, matches the table name.
- (iii) Backtest fixture format: **JSON** — same format as `inputs_frozen`, easy to read and diff.
- (iv) Methodology page: **changelog + link to GitHub blob** for every past version's code.
- (v) CLI binary: **shipped now**, not later — `crates/pegana-replay-cli` with cargo-dist publishing to GitHub Releases mirrored at `releases.pegana.xyz`. Shell + PowerShell + Homebrew installers from day 1. Section 4.7a has the full setup.

---

## 14. References

- Engine code as of `d4a60ff` (2026-05-28): `crates/engine-rs/src/{main,state,thresholds}.rs`.
- Common types: `crates/common/src/lib.rs` (PegState, AssetClass, AlertEvent).
- Existing migrations: `migrations/0001` through `migrations/0027`.
- Existing dispatcher format: `crates/dispatcher-rs/src/format.rs`.
- Existing MCP server: `mcp-ts/src/server.ts`.
- Existing MCP tool `subscribe_peg_events`: `mcp-ts/src/tools/subscribe-peg-events.ts` (uses `alert_events` view).
- Existing bot localization: `bot-ts/locales/{en,pt-BR}.ftl` (Fluent, HTML mode).
- Existing bot `/send` handler: `bot-ts/src/index.ts:1087-1143` (Zod schema accepts arbitrary `vars`).

**External technical references** (validated via context7 and web 2026-05-28):

- Kamino Klend SDK: `/kamino-finance/klend-sdk` (TS, 61 context7 snippets).
- Drift Protocol v2 SDK: `/drift-labs/protocol-v2` (157 snippets).
- Pyth Crosschain SDK + Hermes streaming: `/pyth-network/pyth-crosschain` (2431 snippets).
- Switchboard On-Demand: `/switchboard-xyz/solana-sdk` (51 snippets).
- Jupiter Lend Read SDK: `developers.jup.ag/docs/lend/borrow/read-vault-data`.
- MarginFi TS SDK: `docs.marginfi.com/ts-sdk`.
- Loopscale REST API: `docs.loopscale.com/llms.txt`.
- cargo-dist (binary distribution): `/axodotdev/cargo-dist` (194 snippets).
- Model Context Protocol: `/modelcontextprotocol/modelcontextprotocol` (1710 snippets).
- RFC 8785 JSON Canonicalization Scheme: `serde_json_canonicalizer` crate v0.3 (Feb 2026).

**Prior research (this brainstorming session)**:
- Conversations on 2026-05-28 covering Pegana v2 features F1–F6, decomposition into sub-projects A–E.
- 2025-10-10 USDe event: CoinGecko 10/10 explainer, CoinDesk on Ethena USDe depeg, FTI Consulting crypto crash analysis.
