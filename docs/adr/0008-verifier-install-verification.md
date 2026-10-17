# ADR 0008 — Default install verifies Sigstore attestation

**Status**: Accepted (2026-05-28)
**Context**: Trust Layer v0.1.0; `pegana-replay` CLI distribution

## Problem

`10-distribution.md` shipped two separate paths:

- Default install: `curl … releases.pegana.xyz/installer.sh | sh`
- Verification (opt-in, post-install): `gh attestation verify …`

The product whose purpose is "verify Pegana's claims" is installed without
verification by default. A skeptic who doesn't know Sigstore exists
trusts the binary unilaterally. Additionally, `releases.pegana.xyz` is a
CNAME to `github.com`, introducing DNS/Caddy/cert dependencies that gain
nothing and create new attack surface (DNS hijack, Caddy misconfig,
GitHub token leak).

## Decision

### Install script verifies attestation inline

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://releases.pegana.xyz/install.sh | sh
```

The script:
1. Detects platform (arch + OS).
2. Downloads binary from `github.com/lrafasouza/pegana/releases` directly
   (not via the CNAME).
3. Downloads the Sigstore attestation bundle from the same release.
4. Verifies the attestation:
   - Requires `gh` CLI (most common) OR ships embedded `cosign-verify`
     (decided at implementation time).
   - Verifies signer = GitHub Actions workflow on
     `github.com/lrafasouza/pegana`.
5. If verify fails → abort with clear error pointing to the
   `/methodology#verify` page.
6. If verify passes → move binary to `~/.pegana/bin`.

### Eliminate `releases.pegana.xyz` CNAME dependency

- The install script itself is fetched from `releases.pegana.xyz` (so the
  user-visible URL stays branded) but binaries come from GitHub directly.
- An attacker who hijacks the CNAME can replace the install script — but
  the install script's attestation-verify step still catches a swapped
  binary.
- If the user prefers maximum paranoia, the script is also published at a
  GitHub raw URL, documented on `/methodology`.

### Documented alternatives

`/methodology` page lists three install paths in order:
1. `curl … releases.pegana.xyz/install.sh | sh` (default, verified)
2. `brew install lrafasouza/pegana/pegana-replay` (Homebrew tap, signed)
3. `cargo install pegana-replay-cli --version 0.1.0` (crates.io)
4. Manual: `gh release download && gh attestation verify`

### "Verify the verifier" section

`/methodology` includes a section explaining:
- How to manually verify the attestation
- How to reproduce the binary from source (Docker base image digest pinned)
- How to verify the install script itself

## Why default-verified and not "documented but opt-in"

- The product is trust through verifiability. An unverified default
  install undermines the pitch semantically, not just technically.
- First pentester or sarcastic tweet ("lol curl pipe sh for a trust
  product") destroys credibility cheaply.
- The cost is one engineering day for the install script + cross-platform
  testing.

## Consequences

- +1 day in Phase 9 (CLI distribution): install script with embedded
  verification, tested on 4 platforms (Linux x64, macOS x64, macOS arm64,
  Windows x64).
- Install fails for users without `gh` CLI installed unless the script
  embeds `cosign-verify`. Decision deferred to implementation time but
  documented in the script.
- The `releases.pegana.xyz` CNAME stays (for branding) but is no longer a
  trust dependency.
- Homebrew tap and crates.io paths are promoted to first-class alternatives
  for users who want fully package-manager-mediated trust.

## Cross-refs

- `docs/pegana-trust-layer-v0.1.0/10-distribution.md` (install + Sigstore)
- `docs/pegana-trust-layer-v0.1.0/plans/08-phase-8-9-cli-distribution.md`
- `docs/pegana-trust-layer-v0.1.0/09-web-pages.md` (/methodology verify section)
