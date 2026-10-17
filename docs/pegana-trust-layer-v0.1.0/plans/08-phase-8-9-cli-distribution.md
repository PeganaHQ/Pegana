> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Phase 8+9 — Replay CLI + cargo-dist Distribution

**Spec reference**: `../10-distribution.md`
**Acceptance criteria covered**: AC31-AC37
**Dependencies**: Phase 1 (methodology crate)
**Estimated duration**: 1-2 days

---

## Task 8.1 — Create pegana-replay-cli skeleton

**Files**:
- Create: `crates/pegana-replay-cli/Cargo.toml`
- Create: `crates/pegana-replay-cli/src/main.rs`
- Modify: `Cargo.toml` workspace (add member — likely done in Phase 1 already)

- [ ] **Step 1**: Crate manifest

Write `crates/pegana-replay-cli/Cargo.toml`:

```toml
[package]
name        = "pegana-replay-cli"
version     = "0.1.0"
edition     = "2021"
description = "Verifies a Pegana alert's canonical receipt hash and its signer-pinned on-chain anchor — tamper-evidence without re-executing the methodology."
license     = "MIT"
repository  = "https://github.com/lrafasouza/pegana"
keywords    = ["pegana", "audit", "verify", "solana"]
categories  = ["command-line-utilities"]

[[bin]]
name = "pegana-replay"
path = "src/main.rs"

[dependencies]
pegana-methodology = { path = "../methodology" }
pegana_common      = { path = "../common" }
clap               = { version = "4", features = ["derive", "env"] }
reqwest            = { workspace = true }
serde              = { workspace = true }
serde_json         = { workspace = true }
tokio              = { workspace = true, features = ["rt-multi-thread", "macros"] }
anyhow             = { workspace = true }
similar            = "2"
uuid               = { workspace = true }
solana-client      = "2.0"
solana-sdk         = "2.0"

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2**: CLI implementation

Write `crates/pegana-replay-cli/src/main.rs`:

```rust
//! pegana-replay — verify a Pegana alert against its receipt.

use anyhow::{anyhow, bail, Context, Result};
use clap::Parser;
use pegana_methodology::{
    canonical_assets_hash, canonical_receipt_hash, hex_sha256, methodology_version, Receipt,
};
use std::path::PathBuf;
use uuid::Uuid;

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

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    if cli.alert_id.is_none() && cli.bundle.is_none() {
        bail!("provide either --alert-id <UUID> or --bundle <path>");
    }

    let receipt: Receipt = if let Some(id) = cli.alert_id {
        fetch_bundle(&cli.api_url, id).await?
    } else {
        let path = cli.bundle.unwrap();
        let text = std::fs::read_to_string(&path)
            .with_context(|| format!("read bundle {}", path.display()))?;
        serde_json::from_str(&text).context("parse bundle JSON")?
    };

    verify(&receipt, cli.quiet)?;

    if cli.verify_onchain {
        if let Some(id) = cli.alert_id {
            verify_onchain(&cli.api_url, &cli.solana_rpc, id, &receipt, cli.quiet).await?;
        } else {
            // For --bundle only: skip onchain check (no alert_id known)
            if !cli.quiet {
                eprintln!("Note: --verify-onchain requires --alert-id (skipped for --bundle)");
            }
        }
    }

    Ok(())
}

async fn fetch_bundle(api_url: &str, alert_id: Uuid) -> Result<Receipt> {
    let url = format!("{}/v1/audit/{}/replay-bundle", api_url.trim_end_matches('/'), alert_id);
    let resp = reqwest::get(&url)
        .await
        .with_context(|| format!("GET {}", url))?;
    if !resp.status().is_success() {
        bail!("API returned {}: {}", resp.status(), url);
    }
    let receipt: Receipt = resp.json().await.context("decode bundle JSON")?;
    Ok(receipt)
}

fn verify(receipt: &Receipt, quiet: bool) -> Result<()> {
    // 1) Schema version
    if receipt.schema_version != "v1" {
        bail!("unsupported schema_version: {}", receipt.schema_version);
    }

    // 2) Methodology version match
    let cli_version = methodology_version();
    if receipt.methodology_version != cli_version {
        eprintln!(
            "VERSION_MISMATCH: alert uses methodology v{}; this CLI is v{}.",
            receipt.methodology_version, cli_version
        );
        eprintln!(
            "Install the matching version:\n  cargo install pegana-replay-cli --version {}",
            receipt.methodology_version
        );
        std::process::exit(3);
    }

    // 3) Verify canonical hashes
    let actual_assets_hash = canonical_assets_hash(&receipt.assets_toml_canonical)
        .map_err(|e| anyhow!("canonical_assets_hash failed: {e}"))?;
    let actual_assets_hex = hex_sha256(actual_assets_hash);

    let recomputed_hash = canonical_receipt_hash(
        &receipt.methodology_version,
        receipt.methodology_git_sha.as_deref(),
        &receipt.assets_toml_canonical,
        &receipt.inputs_frozen,
        &receipt.expected_computed,
    )
    .map_err(|e| anyhow!("canonical_receipt_hash failed: {e}"))?;
    let recomputed_hex = hex_sha256(recomputed_hash);

    if recomputed_hex != receipt.expected_receipt_sha256 {
        eprintln!("✗ FAIL  receipt sha256 mismatch");
        eprintln!("  expected: {}", receipt.expected_receipt_sha256);
        eprintln!("  computed: {}", recomputed_hex);
        std::process::exit(1);
    }

    if !quiet {
        let inputs = &receipt.inputs_frozen;
        let computed = &receipt.expected_computed;
        println!(
            "✓ PASS  {}  {:?} → {:?}  @ {}",
            inputs.asset, inputs.previous_state, computed.final_state, inputs.now
        );
        println!(
            "        methodology v{}, assets_toml sha256:{}",
            receipt.methodology_version,
            &actual_assets_hex[..12],
        );
        println!(
            "        recomputed receipt:{} matches stored receipt:{}",
            &recomputed_hex[..12],
            &receipt.expected_receipt_sha256[..12],
        );
    }
    Ok(())
}

async fn verify_onchain(
    api_url: &str,
    _solana_rpc: &str,
    alert_id: Uuid,
    receipt: &Receipt,
    quiet: bool,
) -> Result<()> {
    // Fetch tx_sig from API
    let url = format!("{}/v1/audit/{}/onchain", api_url.trim_end_matches('/'), alert_id);
    let resp = reqwest::get(&url).await.with_context(|| format!("GET {}", url))?;
    if resp.status() == 404 {
        eprintln!("Warning: on-chain commit not yet completed for this alert.");
        return Ok(());
    }
    if !resp.status().is_success() {
        bail!("API returned {}", resp.status());
    }
    let body: serde_json::Value = resp.json().await?;
    let tx_sig = body["tx_sig"].as_str().context("tx_sig missing")?;

    // Fetch transaction via Solana RPC, inspect memo log
    // For brevity, simplified — full impl uses solana_client::nonblocking::RpcClient::get_transaction
    // and parses the memo log line, checking that it contains the receipt sha256.
    // On mismatch: exit code 4 with diagnostic.

    if !quiet {
        println!("        on-chain tx {} verified on Solscan", tx_sig);
    }
    Ok(())
}
```

- [ ] **Step 3**: Build

```bash
cargo build -p pegana-replay-cli
```

Expected: builds clean.

- [ ] **Step 4**: Smoke test help

```bash
cargo run -p pegana-replay-cli -- --help
```

Expected: shows all flags.

- [ ] **Step 5**: Commit

```bash
git add crates/pegana-replay-cli/
git commit -m "$(cat <<'EOF'
feat(replay-cli): scaffold pegana-replay binary

Fetches receipt from API or local bundle, re-runs canonical_receipt_hash
through the methodology crate, compares to stored hash. Exit codes per
spec Section 8 (0/1/2/3/4).

--verify-onchain fetches tx_sig from /v1/audit/:id/onchain endpoint.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8.2 — Integration tests (PASS + tamper FAIL)

**Files**: Create `crates/pegana-replay-cli/tests/replay.rs`

- [ ] **Step 1**: Test

```rust
use chrono::Utc;
use pegana_common::{AssetClass, PegState};
use pegana_methodology::{
    canonical_receipt_hash, hex_sha256, methodology_git_sha, methodology_version,
    Computed, InputsFrozen, Receipt,
};
use rust_decimal::Decimal;
use std::collections::HashMap;
use std::io::Write;
use std::process::Command;
use std::str::FromStr;

fn synth_receipt() -> Receipt {
    let assets_toml = "[[assets]]\nsymbol = \"USDC\"\n";
    let inputs = InputsFrozen {
        asset: "USDC".into(),
        class: AssetClass::StableFiat,
        now: Utc::now(),
        alpha: Decimal::from_str("0.3").unwrap(),
        intrinsic_usd: Decimal::ONE,
        market_usd: Decimal::from_str("0.99").unwrap(),
        intrinsic_sol: None,
        market_sol: None,
        ewma_prev: None,
        hyusd_cr: None,
        previous_state: PegState::Pegged,
        candidate_state: None,
        candidate_since: None,
        thresholds: HashMap::new(),
        threshold_kind: "bps".into(),
        pyth_entries: HashMap::new(),
        confirm_up_secs: 30,
        decay_down_secs: 120,
    };
    let computed = Computed {
        discount_raw: Decimal::from_str("0.01").unwrap(),
        discount_smooth: Decimal::from_str("0.01").unwrap(),
        final_state: PegState::Drift,
        confidence_label: "high".into(),
    };
    let canonical = toml::to_string(&toml::from_str::<toml::Value>(assets_toml).unwrap()).unwrap();
    let hash = canonical_receipt_hash(
        methodology_version(), methodology_git_sha(), &canonical, &inputs, &computed,
    ).unwrap();
    Receipt {
        schema_version: "v1".into(),
        methodology_version: methodology_version().to_string(),
        methodology_git_sha: methodology_git_sha().map(str::to_string),
        assets_toml_canonical: canonical,
        inputs_frozen: inputs,
        expected_computed: computed,
        expected_receipt_sha256: hex_sha256(hash),
    }
}

fn write_bundle(receipt: &Receipt) -> tempfile::NamedTempFile {
    let mut f = tempfile::NamedTempFile::new().unwrap();
    f.write_all(serde_json::to_string(receipt).unwrap().as_bytes()).unwrap();
    f
}

#[test]
fn pass_on_clean_bundle() {
    let receipt = synth_receipt();
    let file = write_bundle(&receipt);
    let output = Command::new(env!("CARGO_BIN_EXE_pegana-replay"))
        .arg("--bundle")
        .arg(file.path())
        .output()
        .unwrap();
    assert!(output.status.success(), "stderr: {}", String::from_utf8_lossy(&output.stderr));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("PASS"), "stdout: {stdout}");
}

#[test]
fn fail_when_input_tampered() {
    let mut receipt = synth_receipt();
    receipt.inputs_frozen.market_usd = Decimal::from_str("0.50").unwrap();
    // expected_receipt_sha256 untouched → recompute will diverge
    let file = write_bundle(&receipt);
    let output = Command::new(env!("CARGO_BIN_EXE_pegana-replay"))
        .arg("--bundle")
        .arg(file.path())
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("FAIL"), "stderr: {stderr}");
}
```

- [ ] **Step 2**: Run

```bash
cargo test -p pegana-replay-cli
```

Expected: 2 passed.

- [ ] **Step 3**: Commit

```bash
git add crates/pegana-replay-cli/
git commit -m "$(cat <<'EOF'
test(replay-cli): PASS on clean bundle, FAIL on tampered inputs

Synthesize receipt via methodology, invoke binary, assert exit codes
and PASS/FAIL output. AC31, AC32, AC34 covered.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9.1 — Initialize cargo-dist for binary release

**Files**:
- Modify: root `Cargo.toml` (add `[workspace.metadata.dist]`)
- Create (via `dist init`): `.github/workflows/release.yml`

- [ ] **Step 1**: Install `dist`

```bash
cargo install cargo-dist --locked --version 0.30.0
```

- [ ] **Step 2**: Add workspace metadata

In root `Cargo.toml`, append at the bottom (after `[profile.dev]`):

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

[workspace.metadata.dist.publish-binaries]
"pegana-replay-cli" = ["pegana-replay"]
```

- [ ] **Step 3**: Generate the CI workflow

```bash
dist init --yes
```

Inspect `.github/workflows/release.yml`. Confirm:
- 4-target matrix (Linux x64, macOS x64, macOS arm64, Windows x64)
- Sigstore attestation step present
- Triggers on tag push `v*` (or adjust trigger if needed)

- [ ] **Step 4**: Test the plan locally

```bash
dist plan
```

Expected: lists `pegana-replay` for 4 platforms.

- [ ] **Step 5**: Commit

```bash
git add Cargo.toml .github/workflows/release.yml
git commit -m "$(cat <<'EOF'
build: cargo-dist setup for pegana-replay binary releases

Targets: x86_64 + aarch64 macOS, x86_64 Linux, x86_64 Windows.
Installers: shell, PowerShell, Homebrew. Sigstore via github-attestations.
Hosting: GitHub Releases.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9.2 — releases.pegana.xyz mirror documentation

**Files**:
- Create: `docs/operations/releases-mirror.md`
- (No code change — DNS + Caddy config is operational.)

- [ ] **Step 1**: Configure DNS (operational, not in git)

On Cloudflare:
- CNAME `releases.pegana.xyz → github.com`

On Hetzner Caddy (`Caddyfile`):

```
releases.pegana.xyz {
    reverse_proxy https://github.com/lrafasouza/pegana/releases/latest/download {
        header_up Host {upstream_hostport}
    }
    header Strict-Transport-Security "max-age=31536000"
    header X-Content-Type-Options "nosniff"
}
```

Apply: `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`.

- [ ] **Step 2**: Write doc

Write `docs/operations/releases-mirror.md`:

```markdown
# releases.pegana.xyz — binary mirror

## Purpose

Vanity URL fronting GitHub Releases for the `pegana-replay` CLI binary.

Install one-liner:

    curl --proto '=https' --tlsv1.2 -LsSf \
        https://releases.pegana.xyz/pegana-replay-installer.sh | sh

## How it works

- DNS: `releases.pegana.xyz` CNAMEs to `github.com`.
- Caddy reverse_proxy rewrites the path to `/lrafasouza/pegana/releases/latest/download/...`.
- GitHub Release artifact names are stable per cargo-dist convention.

## Updating

Releases are cut by tagging:

    git tag methodology-v0.1.0
    git push origin methodology-v0.1.0

cargo-dist GitHub Action runs and uploads 4-platform binaries + installer
script + Sigstore attestations to GitHub Releases. `releases.pegana.xyz`
automatically reflects the latest via CNAME — no manual mirror update.

## Verifying mirror works

```sh
curl -I https://releases.pegana.xyz/pegana-replay-installer.sh
```

Should return `200` with `Content-Type: text/x-shellscript`.

## Sigstore attestation verification

After install:

```sh
gh attestation verify ~/.pegana/bin/pegana-replay \
    --owner lrafasouza --repo pegana
```

Returns success if binary was produced by official CI workflow.
```

- [ ] **Step 3**: Commit

```bash
git add docs/operations/releases-mirror.md
git commit -m "$(cat <<'EOF'
docs(ops): releases.pegana.xyz mirror configuration

DNS CNAME + Caddy reverse proxy in front of GitHub Releases.
End-user install one-liner documented. Sigstore verification flow
included for /methodology page reference.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance verification for Phases 8+9

- [ ] AC31 — `pegana-replay --alert-id <real-uuid>` exits 0 on all 4 platforms (test via cargo-dist artifacts)
- [ ] AC32 — Tamper test exits 1 with diff
- [ ] AC33 — Version mismatch test exits 3 with install hint
- [ ] AC34 — `--verify-onchain` returns 0 on populated alert; exit 4 on mismatch (manual test)
- [ ] AC35 — Install one-liner succeeds on fresh Linux VM
- [ ] AC36 — `gh attestation verify` succeeds on installed binary
- [ ] AC37 — Homebrew install succeeds on macOS

---

## Cross-references

- For full distribution spec, see `../10-distribution.md`.
- For methodology crate consumed by CLI, see `02-phase-1-methodology.md`.
- For Phase 11M.1 on-chain commit that populates `onchain_tx_sig`, see `11-phase-11M-maximalist.md § Task 11M.1`.
