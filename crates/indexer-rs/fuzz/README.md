# Upstream decoder fuzz targets

`decoders` feeds raw bytes to every on-chain account decoder (Perena, PiggyBank,
SPL stake pool, Jupiter perps pool/mint, sUSD, token supply, Marinade); `parsers`
feeds arbitrary JSON/text to the FX, EVM and block parsers. Both call
`indexer_rs::fuzz_entry`, which must never panic.

```bash
cargo install cargo-fuzz
cd crates/indexer-rs
cargo +nightly fuzz run decoders -- -max_total_time=300
cargo +nightly fuzz run parsers  -- -max_total_time=300
```

A deterministic pseudo-random sweep of the same entry points runs in the normal
`cargo test -p indexer-rs` suite (`fuzz_entry::tests`).
