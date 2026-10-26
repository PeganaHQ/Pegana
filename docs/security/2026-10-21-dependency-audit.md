# Dependency audit 2026-10-21

Scope: root `Cargo.lock`, `tools/pegana-replay-public/Cargo.lock` (public ReplayCLI mirror), and the
`docs/examples/webhook-receivers/python-fastapi` example. Tool: `cargo audit` with the RustSec DB as of
2026-10-20 (plus the Dependabot alert list on the public mirror). Waiver bookkeeping lives in
`rustsec-waivers.md` / `.cargo/audit.toml` (renewed to 2026-12-15 in this change).

Finding: most Dependabot alerts were already fixed in the private root lockfile and were stale on the
mirror, because the mirror had not been synced (Actions billing outage) and its manifest was broken
(see "Mirror manifest fix").

## Fixed

| Advisory / alert | Where | Fix |
| --- | --- | --- |
| RUSTSEC-2026-0382 rustls-webpki distrusted intermediates | both | root 0.103.15 -> 0.103.16; mirror 0.103.13 -> 0.103.16 (also covers the <0.103.13 CRL-panic and name-constraint alerts) |
| RUSTSEC-2026-0381 webpki-roots (1.x) | both | 1.0.7 / 1.0.8 -> 1.0.10 |
| rustls TLS1.3 handshake across encryption levels (RUSTSEC-2026-0285), 0346, 0348, 0349 | mirror | 0.23.41 -> 0.23.46 |
| h2 empty DATA frames (RUSTSEC-2026-0258) | mirror | 0.4.15 -> 0.4.20 |
| quinn-proto x5 (RUSTSEC-2026-0338..0342) | mirror | 0.11.16 -> 0.11.19 |
| rustls 0.21 / webpki 0.101 / webpki-roots 0.24, 0.25 families (0104, 0098, 0099, 0346, 0349, ...) | mirror | gone: mirror manifest moved `solana-client` -> `solana-rpc-client` (as the private workspace did), which drops `solana-pubsub-client` / `tokio-tungstenite 0.20` |
| cmov < 0.5.4 (aarch64 wrong results) | root | 0.5.3 -> 0.5.4 |
| serde_with < 3.21.0 (KeyValueMap panic) | root | 3.20.0 -> 3.24.0 (darling 0.24, syn 3 pulled in) |
| rand < 0.8.6 | both | already 0.8.6 in both lockfiles (the vulnerable one is the 0.7.3 line, see below) |
| curve25519-dalek < 4.1.3 | root | already 4.1.3 for the 4.x consumers; the 3.2.0 copy is accepted below |
| cryptography (3 high + medium/low) in python-fastapi example | docs | example deleted (below) |

### Python example removed

`docs/examples/webhook-receivers/python-fastapi/` described a removed feature (webhook registration was
withdrawn, `docs-site/changelog.mdx`; the guides were already deleted). It was referenced only by the
sibling examples README and `scripts/test-webhook-receivers.sh`; both updated. The TypeScript and Rust
examples are untouched (no open alerts). `docs/webhooks/key-rotation.md` also listed it and was updated. Remaining mentions are historical records (`docs/audit-2026-06-19-solanabr/`, `docs/superpowers/` plans and handoffs) and are left as-is.

### Mirror manifest fix

`tools/pegana-replay-public/Cargo.toml` still declared `solana-client`, but `crates/pegana-replay-cli`
uses `solana-rpc-client = { workspace = true }`. The assembled mirror therefore failed with
"`dependency.solana-rpc-client` was not found in `workspace.dependencies`". Now declares
`solana-rpc-client = "2.0"`. Verified by assembling the mirror layout (the three mirrored crates +
overlay + `assets.toml`) in a scratch dir: `cargo build --locked` and `cargo test --locked` pass.
The mirror still needs to be pushed (`scripts/mirror-replaycli.sh`) for Dependabot to see the new lock.

## Accepted (reachability)

| Advisory | Dependency path | Reachability |
| --- | --- | --- |
| RUSTSEC-2022-0093 ed25519-dalek 1.0.1 double public key oracle | `solana-keypair 2.2.3 -> ed25519-dalek 1.0.1` (both lockfiles) | Not reachable. The oracle needs a signer API that accepts an externally supplied public key next to the secret. Pegana's only signing is `engine-rs` `onchain_commit` using `solana_sdk::Keypair::sign_message` with its own key loaded from env. `Keypair::try_from` rejects any 64-byte keypair whose public half does not match the secret-derived key, and `sign_message` goes through `ed25519_dalek::Keypair::sign` (own pair). No attacker-supplied public key exists. `pegana-replay` never signs. Webhook signing uses ed25519-dalek 2.2.0 (not affected). |
| RUSTSEC-2024-0344 curve25519-dalek 3.2.0 timing in `Scalar29::sub` | `ed25519-dalek 1.0.1` | Low severity, local timing side channel on key operations; the signing key is held in a server-side process with no attacker-measurable signing oracle. Same upstream pin as above; fixed only by Solana crates moving to dalek 2.x (solana-sdk 3). |
| RUSTSEC-2026-0097 rand 0.7.3 custom-logger unsoundness | `ed25519-dalek 1.0.1` | Requires a custom `log` logger that itself calls `rand::rng()`. Pegana uses tracing/env_logger without such a logger; rand 0.7 uses the old `thread_rng` API anyway. |
| RUSTSEC-2021-0145 / 2024-0375 atty | `solana-logger -> env_logger 0.9 -> atty` | The unaligned read is Windows-only; Pegana deploys on Linux/macOS (the mirror release matrix is linux + aarch64-darwin). `atty` is only a TTY probe for log colour. |
| RUSTSEC-2026-0381 webpki-roots 0.26.11 (new waiver) | `sqlx-core 0.8.6 -> webpki-roots ^0.26` | No 0.26.x fix exists. Roots are consulted only for a TLS Postgres connection; all Pegana DB URLs are plaintext in-compose `postgres:5432`. Revisit with a sqlx 0.9 migration. |
| RUSTSEC-2026-0235 rkyv 0.7.46 | `rust_decimal` optional feature | Lockfile-only entry; `cargo tree -i rkyv` is empty on both lockfiles. |
| Unmaintained / unsound warnings (bincode 1, derivative, libsecp256k1, number_prefix, paste, memmap2 0.5, event-listener 5.4) | `solana-*` and sqlx transitives | Unchanged; see `rustsec-waivers.md`. |
| `spin` 0.9.8 yanked, `chacha20` 0.10.1 yanked | transitive | Warning only, no advisory. |

Waivers 0098 / 0099 / 0104 (rustls-webpki 0.101) were removed from `.cargo/audit.toml`: that crate no
longer exists in the root graph.

## Not applicable

- The Dependabot cmov / serde_with / rand / rustls / webpki / atty alerts on the **public mirror** reflect
  its stale lockfile; the private lockfiles are the source of truth and are fixed here.

## Result

`cargo audit` root: 0 vulnerabilities, 1 allowed warning. Mirror (no ignore file shipped): remaining
findings are exactly the accepted rows above (dalek 1.x / curve25519 3.x / rkyv phantom / atty / rand 0.7
and the unmaintained set); 0 rustls, webpki, h2, quinn advisories.
Gates: `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`, `cargo test --workspace`
(DB-gated tests self-skip), mirror `cargo build --locked && cargo test --locked`: all green.
