> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# 10 — Distribution

> The `pegana-replay` CLI, cargo-dist binary release pipeline, GitHub Sigstore attestations, `releases.pegana.xyz` mirror, TypeScript + Python SDK auto-generation, and Atom/RSS feeds (`/audit.xml`, `/calibration.xml`).

---

## 1. `pegana-replay` CLI

New binary crate `crates/pegana-replay-cli`. Verifies a Pegana alert's canonical receipt hash and its signer-pinned on-chain anchor, so anyone can confirm the published history wasn't altered (tamper-evidence). The CLI re-hashes frozen inputs + the recorded verdict — it does NOT re-execute the methodology or re-derive the verdict (see ADR-0019).

### Cargo.toml

```toml
[package]
name        = "pegana-replay-cli"
version     = "0.1.0"
edition     = "2021"
description = "Verifies a Pegana alert's canonical receipt hash and its signer-pinned on-chain anchor — tamper-evidence without re-executing the methodology."
license     = "MIT"
repository  = "https://github.com/lrafasouza/pegana"

[[bin]]
name = "pegana-replay"
path = "src/main.rs"

[dependencies]
pegana-methodology = { path = "../methodology" }
pegana_common      = { path = "../common" }
clap               = { version = "4", features = ["derive"] }
reqwest            = { workspace = true }
serde              = { workspace = true }
serde_json         = { workspace = true }
tokio              = { workspace = true, features = ["rt-multi-thread", "macros"] }
anyhow             = { workspace = true }
similar            = "2"   # diff output on FAIL
uuid               = { workspace = true }
solana-client      = "2.0"  # for --verify-onchain
solana-sdk         = "2.0"

[dev-dependencies]
tempfile = "3"
```

### CLI surface

```rust
#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Cli {
    /// Alert UUID to verify by fetching from the API.
    #[arg(long, conflicts_with = "bundle")]
    alert_id: Option<Uuid>,

    /// Path to a local replay bundle JSON.
    #[arg(long, conflicts_with = "alert_id")]
    bundle: Option<PathBuf>,

    /// API base URL.
    #[arg(long, env = "PEGANA_API", default_value = "https://api.pegana.xyz")]
    api_url: String,

    /// Additionally verify the on-chain memo commitment.
    #[arg(long)]
    verify_onchain: bool,

    /// Solana RPC URL for --verify-onchain.
    #[arg(long, env = "SOLANA_RPC_URL", default_value = "https://api.mainnet-beta.solana.com")]
    solana_rpc: String,

    /// Suppress all output except final PASS/FAIL.
    #[arg(long)]
    quiet: bool,
}
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | PASS — hashes match, receipt verified |
| 1 | FAIL — computed values or receipt hash differ (with diff output) |
| 2 | ERROR — network failure, malformed bundle, unknown alert |
| 3 | VERSION_MISMATCH — CLI methodology version ≠ alert's |
| 4 | ONCHAIN_MISMATCH — on-chain memo content ≠ bundle's receipt hash (only when `--verify-onchain`) |

### Flow

1. **Acquire bundle**: either GET `/v1/audit/<id>/replay-bundle` OR read local `--bundle <file>`.
2. **Version check**: compare `bundle.methodology_version` to CLI's `pegana_methodology::methodology_version()`. Mismatch → exit 3 with install hint (`cargo install pegana-replay-cli --version <ver>`).
3. **Re-canonicalize**: call `canonical_assets_hash(bundle.assets_toml_canonical)` and `canonical_receipt_hash(...)` with bundle inputs.
4. **Compare hashes**: recomputed hash vs `bundle.expected_receipt_sha256`. Mismatch → exit 1 with diff.
5. **Optional `--verify-onchain`**: GET `/v1/audit/<id>/onchain`, parse `tx_sig`, fetch transaction via RPC, inspect memo log lines, verify payload contains `bundle.expected_receipt_sha256`. Mismatch → exit 4.
6. **PASS output**:
   ```
   ✓ PASS  USDe  PEGGED → DEPEG  @ 2026-05-28T14:33:12Z
            methodology v0.1.0, assets_toml sha256:abc12345...
            recomputed receipt:def67890... matches stored receipt:def67890...
   [--verify-onchain only] on-chain tx 5abc...xyz verified on Solscan
   ```

---

## 2. cargo-dist binary distribution

### Workspace setup

Root `Cargo.toml` adds:

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
github-attestations   = true   # Sigstore via GitHub OIDC

# Publish ONLY the public CLI; workspace internals stay private
[workspace.metadata.dist.publish-binaries]
"pegana-replay-cli" = ["pegana-replay"]
```

### Setup commands

```bash
# Install dist (formerly cargo-dist)
cargo install cargo-dist --locked --version 0.30.0

# Generate CI workflow
dist init --yes

# Verify plan
dist plan
```

This creates `.github/workflows/release.yml` that triggers on tag push `methodology-v*`, builds for 4 targets, uploads to GitHub Releases with Sigstore attestations.

### End-user install

**Shell (Linux/macOS)**:
```bash
curl --proto '=https' --tlsv1.2 -LsSf https://releases.pegana.xyz/pegana-replay-installer.sh | sh
```

**PowerShell (Windows)**:
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://releases.pegana.xyz/pegana-replay-installer.ps1 | iex"
```

**Homebrew (macOS, via tap)**:
```bash
brew tap lrafasouza/pegana
brew install pegana-replay
```

**Cargo (for Rust devs)**:
```bash
cargo install pegana-replay-cli --version 0.1.0
```

### Sigstore attestation verification

After install, skeptics can verify the binary was built by official CI:

```bash
gh attestation verify ~/.pegana/bin/pegana-replay \
    --owner lrafasouza \
    --repo pegana
```

Returns success if the binary was produced by the GitHub Actions workflow on `github.com/lrafasouza/pegana`. No keys to manage, no separate trust root — Sigstore + GitHub OIDC.

---

## 3. `releases.pegana.xyz` mirror

DNS: CNAME `releases.pegana.xyz → github.com`.

Caddy reverse proxy on Hetzner (`Caddyfile`):

```
releases.pegana.xyz {
    reverse_proxy https://github.com/lrafasouza/pegana/releases/latest/download {
        header_up Host {upstream_hostport}
    }
    header Strict-Transport-Security "max-age=31536000"
    header X-Content-Type-Options "nosniff"
}
```

End-user URL `https://releases.pegana.xyz/pegana-replay-installer.sh` proxies to the latest cargo-dist artifact on GitHub. No manual mirror update — `latest` tracks new releases automatically.

Documented in `docs/operations/releases-mirror.md` (new ops doc).

---

## 4. Auto-generated SDKs

### Source of truth

OpenAPI 3.1 spec served at `https://api.pegana.xyz/openapi.json` (auto-generated via utoipa, already in production).

### Tooling

`@openapitools/openapi-generator-cli` v7.22.0 — active, 23k context7 snippets, supports `typescript-fetch` + `python` generators.

### TypeScript SDK: `@pegana/sdk-ts`

Generated with `typescript-fetch` template. Published to npm.

```bash
openapi-generator-cli generate \
    -i https://api.pegana.xyz/openapi.json \
    -g typescript-fetch \
    -o sdk/typescript \
    --additional-properties npmName=@pegana/sdk-ts,supportsES6=true
```

Usage example:
```typescript
import { AuditApi } from "@pegana/sdk-ts";
const api = new AuditApi();
const receipt = await api.getAudit({ alertId: "..." });
```

### Python SDK: `pegana-sdk`

Generated with `python` template (Pydantic v2 mode). Published to PyPI.

```bash
openapi-generator-cli generate \
    -i https://api.pegana.xyz/openapi.json \
    -g python \
    -o sdk/python \
    --additional-properties packageName=pegana_sdk,projectName=pegana-sdk
```

Usage:
```python
from pegana_sdk import AuditApi
api = AuditApi()
receipt = api.get_audit(alert_id="...")
```

### CI workflow

`.github/workflows/sdk-release.yml`:

```yaml
name: Generate and publish SDKs
on:
  workflow_dispatch:
  push:
    tags: ["sdk-v*"]
jobs:
  generate-and-publish:
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: '22', registry-url: 'https://registry.npmjs.org' }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: npm install -g @openapitools/openapi-generator-cli@7.22.0
      - name: Fetch live OpenAPI spec
        run: curl -fsSL -o /tmp/openapi.json https://api.pegana.xyz/openapi.json
      - name: Generate TypeScript SDK
        run: openapi-generator-cli generate -i /tmp/openapi.json -g typescript-fetch -o sdk/typescript --additional-properties npmName=@pegana/sdk-ts,supportsES6=true
      - name: Generate Python SDK
        run: openapi-generator-cli generate -i /tmp/openapi.json -g python -o sdk/python --additional-properties packageName=pegana_sdk,projectName=pegana-sdk
      - name: Publish TS SDK to npm
        env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} }
        working-directory: sdk/typescript
        run: npm install && npm run build && npm publish --access public
      - name: Publish Python SDK to PyPI
        env: { TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}, TWINE_USERNAME: __token__ }
        working-directory: sdk/python
        run: pip install build twine && python -m build && python -m twine upload dist/*
```

Triggered manually or via `git tag sdk-v0.1.0 && git push origin sdk-v0.1.0`.

### Release cadence

- **PATCH** (`sdk-v0.1.x`): additive API endpoints added
- **MINOR** (`sdk-v0.x.0`): new tags / model additions, mostly backward-compatible
- **MAJOR** (`sdk-v1.0.0`): breaking endpoint changes

SDKs generated against API version they were released alongside. Version policy documented in `sdk/README.md`.

---

## 5. RSS/Atom feeds

### `/audit.xml`

Already covered in `09-web-pages.md § Atom feeds`. Atom 1.0 via `feed` npm package, sources last 50 non-PEGGED audits from `/v1/audit`. Cached 60s SWR.

### `/calibration.xml`

Atom 1.0 of last 100 `assets.toml` mutations from git log. Filtered to commits touching threshold definitions or asset row add/remove. Cached 1h.

Both feeds discoverable via `<link rel="alternate" type="application/atom+xml">` in root `app/layout.tsx`.

---

## 6. Reproducible builds

CI verification that the engine binary is bit-for-bit reproducible on the same machine.

### `.github/workflows/reproducible.yml`

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
      - uses: dtolnay/rust-toolchain@1.90
      - uses: Swatinem/rust-cache@v2
        with: { shared-key: "ci-reproducible" }
      - name: Build engine first time
        run: cargo build --release --locked --frozen -p pegana-engine
      - name: Hash first build
        run: sha256sum target/release/pegana-engine | tee /tmp/hash-1
      - name: Clean and rebuild
        run: |
          cargo clean -p engine-rs
          cargo build --release --locked --frozen -p pegana-engine
      - name: Hash second build
        run: sha256sum target/release/pegana-engine | tee /tmp/hash-2
      - name: Compare
        run: |
          if ! diff /tmp/hash-1 /tmp/hash-2; then
            echo "Build is NOT reproducible on the same machine!"
            exit 1
          fi
          echo "OK: same-machine bit-for-bit reproducible"
```

### Docker base image pinning

All Dockerfiles pin base images by `@sha256:` digest:

```dockerfile
# Before (mutable tag)
FROM rust:1.90.0-slim-bookworm AS builder
# After (immutable digest)
FROM rust:1.90.0-slim-bookworm@sha256:abc123def456... AS builder
```

Same for `oven/bun:latest`, `node:22-alpine`, etc. Capture digests:

```bash
docker pull rust:1.90.0-slim-bookworm
docker images --digests rust:1.90.0-slim-bookworm
```

Update digests as part of monthly maintenance OR when CVE forces.

### Binary checksum publication

Each release commit publishes the engine binary's sha256 in `docs/CHECKSUMS.md` AND on `/methodology#binary-checksums`. Anyone with source can `git checkout <tag> && cargo build --release --locked --frozen -p pegana-engine && sha256sum target/release/pegana-engine`.

### Scope limitation

v0.1.0 target: **same-machine** bit-for-bit reproducibility (rebuild on same CI runner = same hash). Cross-runner full reproducibility (different Linux distros, ARM vs x64) requires more (SOURCE_DATE_EPOCH, stripped timestamps, deterministic linker flags). Deferred to v0.2.0.

---

## 7. Cost summary

| Item | Cost |
|---|---|
| GitHub Releases hosting | Free (public repos) |
| Sigstore attestations | Free (OIDC, no key management) |
| npm publish (`@pegana/sdk-ts`) | Free (public scope) |
| PyPI publish (`pegana-sdk`) | Free |
| Atom feed serving (Vercel cache) | Within Vercel free tier |
| Embed widget CDN | Vercel free tier |
| Reproducible build CI | Within GitHub Actions free tier for public repos |
| `releases.pegana.xyz` proxy | Existing Caddy + Cloudflare DNS — no marginal cost |

Total new OpEx for distribution: **$0/month**.

---

## 8. Cross-references

- For replay CLI implementation, see `plans/08-phase-8-9-cli-distribution.md`.
- For cargo-dist setup, see `plans/08-phase-8-9-cli-distribution.md § Task 9.1`.
- For SDK release workflow, see `plans/11-phase-11M-maximalist.md § Task 11M.5`.
- For Atom feed implementation, see `plans/11-phase-11M-maximalist.md § Task 11M.2` and `§ Task 11M.6`.
- For reproducible build CI, see `plans/11-phase-11M-maximalist.md § 11M.7`.
- For acceptance criteria AC31-AC37, AC48-AC73, see `12-acceptance-criteria.md § CLI distribution`, `§ Feeds and syndication`, `§ SDKs`, `§ Reproducible builds`.
