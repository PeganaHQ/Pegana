#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    indexer_rs::fuzz_entry::parsers(data);
});
