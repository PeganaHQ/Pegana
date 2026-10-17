//! Library surface of the dispatcher crate — exposes the modules the
//! binary uses internally so integration tests in `tests/` can import
//! them. The binary entry point lives in `src/main.rs` and uses these
//! same modules via the same paths.

pub mod retraction;
pub mod webhook;
pub mod webhook_queries;
