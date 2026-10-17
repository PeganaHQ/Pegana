> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# 05 — Methodology Crate

> `crates/methodology` — pure, versioned, deterministic. The foundation of the Trust Layer: same functions called by engine at runtime and replay CLI offline.

---

## 1. Purpose

Three problems this crate solves:

1. **Determinism**: methodology must produce identical output for identical input regardless of caller, machine, or wall clock. Pure functions only.
2. **Versioning**: methodology evolves; past alerts must remain checkable against the version that produced them. Semver in code + records in DB.
3. **Verifiability**: an external skeptic with the same crate version + same inputs must compute the same canonical hash. RFC 8785 JCS encoding.

---

## 2. Crate manifest

```toml
# crates/methodology/Cargo.toml

[package]
name        = "pegana-methodology"
version     = "0.1.0"
edition     = "2021"
description = "Pure, versioned methodology functions for Pegana's peg-risk engine. Used by engine at runtime and by pegana-replay-cli for offline verification."
license     = "MIT"
repository  = "https://github.com/lrafasouza/pegana"

[dependencies]
pegana_common              = { path = "../common" }
rust_decimal               = { workspace = true }
serde                      = { workspace = true }
serde_json                 = { workspace = true }
chrono                     = { workspace = true }
toml                       = { workspace = true }
thiserror                  = { workspace = true }
sha2                       = "0.10"
serde_json_canonicalizer   = "0.3"   # RFC 8785 JCS

[dev-dependencies]
proptest = "1"
```

**No tokio, no sqlx, no reqwest, no async**. The crate compiles to a tight, fast lib usable in any Rust context.

---

## 3. Module layout

```
crates/methodology/
├── Cargo.toml
├── CHANGELOG.md
└── src/
    ├── lib.rs          # public re-exports
    ├── discount.rs     # compute_discount, is_plausible_discount_sample
    ├── ewma.rs         # apply_ewma_pure
    ├── thresholds.rs   # state_for_bps_*, state_for_cr, is_direction_sensitive
    ├── transition.rs   # transition_decide, TransitionDecision
    ├── version.rs      # methodology_version, methodology_git_sha
    ├── canonical.rs    # canonical_assets_hash, canonical_receipt_hash, hex_sha256, MethodologyError
    └── receipt.rs      # Receipt, InputsFrozen, Computed, PythEntry structs
```

---

## 4. Public API

```rust
// crates/methodology/src/lib.rs

pub mod canonical;
pub mod discount;
pub mod ewma;
pub mod receipt;
pub mod thresholds;
pub mod transition;
pub mod version;

pub use canonical::{canonical_assets_hash, canonical_receipt_hash, hex_sha256, MethodologyError};
pub use discount::{compute_discount, is_plausible_discount_sample};
pub use ewma::apply_ewma_pure;
pub use receipt::{Computed, InputsFrozen, PythEntry, Receipt};
pub use thresholds::{
    is_direction_sensitive, state_for_bps_discount, state_for_bps_discount_aware, state_for_cr,
};
pub use transition::{transition_decide, TransitionDecision};
pub use version::{methodology_git_sha, methodology_version};
```

---

## 5. `discount` module

### `compute_discount`

Mirrors engine `try_recompute` lines 353-362 exactly:

```rust
pub fn compute_discount(
    intrinsic: Decimal,
    market: Decimal,
    intrinsic_sol: Option<Decimal>,
    market_sol: Option<Decimal>,
    class: AssetClass,
) -> Decimal {
    if intrinsic.is_zero() {
        return Decimal::ZERO;
    }
    if matches!(class, AssetClass::Lst) {
        if let (Some(i_sol), Some(m_sol)) = (intrinsic_sol, market_sol) {
            if !i_sol.is_zero() {
                return Decimal::ONE - (m_sol / i_sol);
            }
        }
    }
    Decimal::ONE - (market / intrinsic)
}
```

**LST SOL-path preference**: when both `intrinsic_sol` and `market_sol` are present for an LST, compute discount in SOL terms. This cancels the `pyth(SOL/USD)` multiplier race that historically painted LSTs with phantom drift during fast SOL price moves (see `docs/incident-2026-05-25-lst-burst.md`).

### `is_plausible_discount_sample`

```rust
pub fn is_plausible_discount_sample(d: Decimal) -> bool {
    d.abs() <= Decimal::ONE
}
```

Discounts with `|d| > 1.0` (market more than 100% off intrinsic) are physically impossible for any tracked class. They're upstream noise (stale Pyth tick, empty Jupiter route, degenerate Hylo NAV edge). Filtering them protects the EWMA from getting poisoned for 7 buckets (α=0.3 decay).

---

## 6. `ewma` module

```rust
pub fn apply_ewma_pure(raw: Decimal, prev: Option<Decimal>, alpha: Decimal) -> Decimal {
    match prev {
        None => raw,
        Some(p) => alpha * raw + (Decimal::ONE - alpha) * p,
    }
}
```

**Property tests** (`proptest`):

1. **Seeding**: when `prev = None`, result equals `raw`.
2. **α=0**: `apply_ewma_pure(raw, Some(prev), 0) == prev` (no contribution from new sample).
3. **α=1**: `apply_ewma_pure(raw, Some(prev), 1) == raw` (full replacement).
4. **Bounded**: for any `raw`, `prev`, `α ∈ [0,1]`: `min(raw,prev) ≤ result ≤ max(raw,prev)`.

Random `Decimal` inputs in range `[-1, 1]` for `raw`/`prev` and `α ∈ [0.0, 1.0]`.

---

## 7. `thresholds` module

**Moved verbatim** from `crates/engine-rs/src/thresholds.rs` (which is deleted in Phase 2). All 10 existing tests move with the code.

```rust
pub fn is_direction_sensitive(class: AssetClass) -> bool {
    matches!(class, AssetClass::StableYield)
}

pub fn state_for_bps_discount_aware(
    class: AssetClass,
    discount: Decimal,
    thresholds: &HashMap<String, u32>,
) -> PegState {
    if is_direction_sensitive(class) && discount < Decimal::ZERO {
        return PegState::Pegged;
    }
    state_for_bps_discount(discount, thresholds)
}

pub fn state_for_bps_discount(discount: Decimal, thresholds: &HashMap<String, u32>) -> PegState {
    // ... existing implementation
}

pub fn state_for_cr(cr: Decimal, thresholds: &HashMap<String, u32>) -> PegState {
    // ... existing implementation
}
```

**Direction-sensitivity matrix**:

| Class | Discount direction matters? | Premium normalization? |
|---|---|---|
| `Lst` | Symmetric | No |
| `StableFiat` | Symmetric | No |
| `StableDn` (USDe, JupUSD) | Symmetric | No |
| `StableCdp` (hyUSD, USDS) | Symmetric (or CR-based for hyUSD) | No |
| `StableYield` (USDY, sUSDe, syrupUSDC, etc.) | Discount-only | **Yes** — premium → PEGGED |
| `StableFx` (BRZ) | Symmetric | No |
| `SynthLev` (xSOL) | Symmetric | No |

---

## 8. `transition` module

Pure state-machine step extracted from `engine-rs/src/state.rs::transition` (lines 258-296). Takes `now` explicitly.

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransitionDecision {
    pub new_last_state: PegState,
    pub new_candidate_state: Option<PegState>,
    pub new_candidate_since: Option<DateTime<Utc>>,
}

pub fn transition_decide(
    current_last_state: PegState,
    candidate: PegState,
    prev_candidate_state: Option<PegState>,
    prev_candidate_since: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
    confirm_up_secs: i64,
    decay_down_secs: i64,
) -> TransitionDecision {
    // Same algorithm as state.rs::transition, parameterized by now
}
```

**Tests** (truth table over 6×6 state pairs × 3 time scenarios = 108 cases):
- Same-state candidate clears pending.
- New candidate is recorded with `now` as `since`.
- Same candidate matures after `confirm_up_secs` (upward) or `decay_down_secs` (downward).
- Time < threshold keeps candidate pending.

---

## 9. `version` module

```rust
pub fn methodology_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn methodology_git_sha() -> Option<&'static str> {
    option_env!("PEGANA_GIT_SHA")
}
```

- `methodology_version`: compile-time read of crate's `Cargo.toml` version. Returns `"0.1.0"` for the initial release.
- `methodology_git_sha`: populated by Docker build arg `PEGANA_GIT_SHA=$(git rev-parse HEAD)`. Returns `None` for local dev builds (which is fine — receipts from dev builds carry `methodology_git_sha: null` and the replay CLI warns "this alert was generated by a dev build; reproducibility not guaranteed").

**Production deploy convention**: Dockerfile's RUN cargo build sets `--env PEGANA_GIT_SHA=$(git rev-parse HEAD)`. This puts the SHA in every binary's `methodology_git_sha()` return.

---

## 10. `canonical` module — the heart of verifiability

### `canonical_assets_hash`

```rust
pub fn canonical_assets_hash(toml_str: &str) -> Result<[u8; 32], MethodologyError> {
    let value: toml::Value = toml::from_str(toml_str)?;
    let canonical = toml::to_string(&value)?;
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    Ok(hasher.finalize().into())
}
```

**Why parse + re-serialize**: comments, whitespace, and key order in raw TOML don't change semantics. Canonicalizing produces the same hash whether the file has 50 comments or none.

**Test**:
```rust
let with_comments = "[[assets]]\nsymbol = \"USDC\"\n# this is a comment\n";
let without = "[[assets]]\nsymbol = \"USDC\"\n";
assert_eq!(canonical_assets_hash(with_comments)?, canonical_assets_hash(without)?);
```

### `canonical_receipt_hash`

```rust
pub fn canonical_receipt_hash(
    methodology_version: &str,
    methodology_git_sha: Option<&str>,
    assets_toml_canonical: &str,
    inputs_frozen: &InputsFrozen,
    computed: &Computed,
) -> Result<[u8; 32], MethodologyError> {
    let mut hasher = Sha256::new();
    hasher.update(methodology_version.as_bytes());
    hasher.update(b"\x00");
    hasher.update(methodology_git_sha.unwrap_or("").as_bytes());
    hasher.update(b"\x00");
    hasher.update(assets_toml_canonical.as_bytes());
    hasher.update(b"\x00");
    let inputs_bytes = serde_json_canonicalizer::to_string(inputs_frozen)?;
    hasher.update(inputs_bytes.as_bytes());
    hasher.update(b"\x00");
    let computed_bytes = serde_json_canonicalizer::to_string(computed)?;
    hasher.update(computed_bytes.as_bytes());
    Ok(hasher.finalize().into())
}
```

**`serde_json_canonicalizer` choice rationale** (vs the older `serde_jcs`): SJC is RFC 8785-compliant, actively maintained (Feb 2026 release), and handles `Decimal` serialized as strings correctly. SJC handles UTF-8 encoding, number formatting (per ECMAScript 6+ spec for the few `f64` cases we don't have anyway since we serialize Decimal as strings), array element order preservation, object key sorting.

**Null byte separator (0x00)**: prevents prefix-collision between the 5 concatenated parts. Without it, `("0.1.0", "abc...", "def...")` and `("0.1.0a", "bc...", "def...")` would hash to the same value.

### `hex_sha256`

```rust
pub fn hex_sha256(digest: [u8; 32]) -> String {
    digest.iter().fold(String::with_capacity(64), |mut acc, b| {
        acc.push_str(&format!("{:02x}", b));
        acc
    })
}
```

Lowercase hex, no `0x` prefix, 64 chars. Stored in `alert_evidence.receipt_sha256` (CHAR(64)).

### `MethodologyError`

```rust
#[derive(Debug, Error)]
pub enum MethodologyError {
    #[error("failed to parse assets.toml: {0}")]
    AssetsTomlParse(#[from] toml::de::Error),

    #[error("failed to serialize canonical TOML: {0}")]
    AssetsTomlSerialize(#[from] toml::ser::Error),

    #[error("canonical JSON encode failed: {0}")]
    CanonicalJson(#[from] serde_json::Error),
}
```

---

## 11. `receipt` module — the data shapes

See `04-data-model.md § JSONB schemas` for full field-by-field semantics. The Rust types:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PythEntry {
    pub price: Decimal,
    pub confidence: Decimal,
    pub publish_time: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputsFrozen {
    pub asset: String,
    pub class: AssetClass,
    pub now: DateTime<Utc>,
    pub alpha: Decimal,
    pub intrinsic_usd: Decimal,
    pub market_usd: Decimal,
    pub intrinsic_sol: Option<Decimal>,
    pub market_sol: Option<Decimal>,
    pub ewma_prev: Option<Decimal>,
    pub hyusd_cr: Option<Decimal>,
    pub previous_state: PegState,
    pub candidate_state: Option<PegState>,
    pub candidate_since: Option<DateTime<Utc>>,
    pub thresholds: HashMap<String, u32>,
    pub threshold_kind: String,                              // "bps" | "cr"
    pub pyth_entries: HashMap<String, PythEntry>,
    pub confirm_up_secs: i64,
    pub decay_down_secs: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Computed {
    pub discount_raw: Decimal,
    pub discount_smooth: Decimal,
    pub final_state: PegState,
    pub confidence_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub schema_version: String,
    pub methodology_version: String,
    pub methodology_git_sha: Option<String>,
    pub assets_toml_canonical: String,
    pub inputs_frozen: InputsFrozen,
    pub expected_computed: Computed,
    pub expected_receipt_sha256: String,
}
```

---

## 12. Versioning rules (semver)

The `methodology` crate's version is its API contract for verifiers. Strict semver:

- **PATCH** (`0.1.0 → 0.1.1`): refactor without observable behavior change. Receipt hashes for the same inputs may still differ (because version string is hashed), but `expected_computed` is identical.
- **MINOR** (`0.1.0 → 0.2.0`): new pure function added; existing functions unchanged in output for any input. Compatible — but receipts produced by `0.1.0` cannot be replayed with `0.2.0` CLI (version mismatch → exit code 3).
- **MAJOR** (`0.x → 1.0`): any existing function changes output for some input. Past receipts remain inspectable but no longer replayable with new CLI. The old version stays in `methodology_versions` table marked `deprecated` (or `broken` if the change fixes a bug).

**Each version gets a git tag**: `git tag methodology-v0.1.0`. The CLI install command suggests `cargo install pegana-replay-cli --version 0.1.0` so a verifier checking an old alert installs the matching CLI version.

**CI enforcement**: a GitHub Actions check fails any PR that touches `crates/methodology/src/` without bumping `Cargo.toml` `version`. See `plans/02-phase-1-methodology.md`.

---

## 13. CHANGELOG.md format

```markdown
# pegana-methodology changelog

## 0.1.0 — 2026-05-29

- Initial public release.
- Extracted pure functions from `pegana-engine` v0.1.0; no behavior change.
- Provides: `compute_discount`, `apply_ewma_pure`, `transition_decide`,
  `state_for_bps_discount*`, `state_for_cr`, `is_plausible_discount_sample`,
  `canonical_assets_hash`, `canonical_receipt_hash`, `methodology_version`,
  `methodology_git_sha`.
- Receipt schema: v1. See `04-data-model.md § JSONB schemas`.

## 0.2.0 — TBD

- (Future entry — populate when next version ships.)
```

Rendered on `/methodology` web page (read at build time via `fs.readFile`). See `09-web-pages.md § /methodology`.

---

## 14. Cross-references

- For where the engine calls each function, see `06-engine-changes.md § Summary of changes`.
- For where the replay CLI calls each function, see `10-distribution.md § pegana-replay`.
- For receipt JSONB shape in DB, see `04-data-model.md § JSONB schemas`.
- For implementation tasks, see `plans/02-phase-1-methodology.md`.
- For acceptance criteria AC1-AC5, see `12-acceptance-criteria.md § Methodology crate`.
