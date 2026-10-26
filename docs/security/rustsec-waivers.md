# RustSec advisory waivers

`cargo audit` enforcement is configured in `.cargo/audit.toml`. These waivers preserve the advisories currently ignored by CI. Adding or removing an ID requires updating both files.

All waivers have:

- Owner: Rafael Souza
- Review date: 2026-10-21
- Expiry: 2026-12-15
- Compensating control: CI continues to run pinned `cargo-audit` against every lockfile change, denies new vulnerability advisories by default, and denies new `unmaintained` and `unsound` warnings; dependency upgrades must re-check the affected inverse dependency tree and remove the waiver when reachable.

## Vulnerabilities

| Advisory | Dependency / reachability rationale |
| --- | --- |
| RUSTSEC-2024-0344 | `curve25519-dalek` 3.2 timing; `solana-sdk → curve25519-dalek`. |
| RUSTSEC-2022-0093 | `ed25519-dalek` 1.0 oracle; `solana-keypair → ed25519-dalek`. |
| RUSTSEC-2023-0071 | `rsa` 0.9 Marvin timing; sqlx transitive; Pegana does not use MySQL. |
| RUSTSEC-2026-0381 | `webpki-roots` 0.26.11 bundled roots trust distrusted emSign intermediates; `sqlx-core 0.8.6 → webpki-roots ^0.26` (no 0.26.x fix; fix is 1.0.10+). Only consulted when sqlx opens a TLS Postgres connection; every Pegana DB URL targets the in-compose `postgres:5432` over plaintext, so the root store is never used. The other `webpki-roots` consumers (reqwest) were bumped to 1.0.10. Remove on sqlx 0.9 migration. |
| RUSTSEC-2021-0145 | `atty` unaligned read; `solana-logger → env_logger 0.9 → atty`. |
| RUSTSEC-2026-0097 | `rand` 0.7 unsound with custom logger; `solana-keypair → ed25519-dalek 1.0 → rand 0.7`. |
| RUSTSEC-2026-0235 | `rkyv` 0.7 archive validation; optional dependency declared by `rust_decimal` but disabled in every workspace and target graph (`cargo tree --target all -i rkyv -e features` is empty). Pegana does not serialize or validate rkyv archives. `rust_decimal` 1.42.1 still declares `rkyv` 0.7, so no upstream-compatible lock update removes it. |

## Unmaintained warnings

| Advisory | Dependency / reachability rationale |
| --- | --- |
| RUSTSEC-2024-0375 | `atty` unmaintained; same source as RUSTSEC-2021-0145. |
| RUSTSEC-2024-0388 | `derivative` unmaintained; `solana-bn254 → ark-ec`. |
| RUSTSEC-2024-0436 | `paste` unmaintained; `solana-bn254 → ark-ff`. |
| RUSTSEC-2025-0119 | `number_prefix` unmaintained; `solana-client → indicatif`. |
| RUSTSEC-2025-0141 | `bincode` 1.x unmaintained; `solana-account`. |
| RUSTSEC-2025-0161 | `libsecp256k1` unmaintained; `solana-secp256k1-program`. |

## Unsound warnings

| Advisory | Dependency / reachability rationale |
| --- | --- |
| RUSTSEC-2026-0186 | `memmap2` 0.5 unchecked pointer offset; `solana-genesis-config → memmap2 0.5`. The fix needs >=0.9.11 but Solana pins 0.5, so `cargo update` cannot reach it; Pegana loads no genesis file, so the mmap path is never executed. |
| RUSTSEC-2026-0221 | `event-listener` 5.4 unsound; `sqlx → event-listener`. `!Send` tags cross thread boundaries; Pegana uses no `!Send` tags. |
