//! Pegana indexer library: ingestion sources, sinks and supervision. The binary
//! (`main.rs`) wires them together; the library form also lets the fuzz targets
//! under `fuzz/` reach the upstream decoders.

pub mod config;
pub mod fuzz_entry;
pub(crate) mod http_util;
pub(crate) mod rpc;
pub(crate) mod sinks;
pub mod sources;
pub mod state;
pub mod supervisor;
