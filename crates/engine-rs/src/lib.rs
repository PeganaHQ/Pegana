//! Library surface for `engine-rs`.
//!
//! The engine is primarily a binary (`src/main.rs`), but the two self-contained
//! background workers are also exposed here so integration tests in `tests/`
//! can drive a single tick / the inner step function against a real Postgres
//! without booting the whole recompute pipeline:
//!
//!   * [`onchain_commit`]    — ADR-0004 on-chain commit + dead-letter retry.
//!   * [`evidence_reconcile`] — ADR-0006 alert_evidence_pending reconcile.
//!
//! Both modules are dependency-free of the binary's recompute internals (no
//! `crate::` references into `main.rs`), so they live cleanly in the lib and
//! are re-used by the binary via `use engine_rs::{…}`.

pub mod evidence_reconcile;
pub mod onchain_commit;
