# Reproducible builds — ops recipe

> Wave 11M.7 — documents the v0.1.0 same-machine bit-for-bit reproducibility
> target. Full cross-runner reproducibility (different distros, ARM ≠ x64)
> is deferred to v0.2.0; see `docs/pegana-trust-layer-v0.1.0/10-distribution.md
> § 6 Scope limitation`.

This recipe lets an auditor independently rebuild any Pegana service
artifact and compare its hash against the published checksum. It does **not**
yet run in CI as a gating check — that flips on once we've validated the
recipe holds across our supported runners. The stub workflow at
`.github/workflows/reproducible-build.yml` carries the same logic for
operators to invoke on demand via `workflow_dispatch`.

---

## 1. What is pinned today

### Cargo workspace

- `Cargo.lock` is checked in at the repository root.
- All `cargo build` invocations in CI and operator recipes use
  `--locked --frozen` so any drift fails the build.
- Toolchain pin: `rust-toolchain.toml` selects the channel; CI uses
  `dtolnay/rust-toolchain@1.90` matching it.

### TypeScript packages

- `web/bun.lock` is checked in.
- `bot-ts/bun.lock` is checked in.
- `mcp-ts/bun.lock` is checked in.
- `bun install --frozen-lockfile` is the canonical install command — drift
  fails with a non-zero exit.

### Docker base images

Captured 2026-05-28. Update when CVE forces or during monthly maintenance.

| Image | Reference | Used by |
|---|---|---|
| `rust:1.90-slim` | mutable tag → pin via `docker pull rust:1.90-slim && docker inspect rust:1.90-slim --format='{{index .RepoDigests 0}}'` | `crates/api-rs`, `crates/engine-rs`, `crates/indexer-rs`, `crates/dispatcher-rs` |
| `debian:bookworm-slim` | mutable tag → pin via the same `inspect` recipe | runtime stage of all Rust crates above |
| `oven/bun:1` | mutable tag → pin via `inspect` | `mcp-ts` builder |
| `oven/bun:1-slim` | mutable tag → pin via `inspect` | `mcp-ts` runtime |
| `oven/bun:1.2-alpine` | mutable tag → pin via `inspect` | `bot-ts` deps + runtime |

> ✅ **DONE (AC72, `landing/v2-port`, 2026-07-17 — not yet deployed).** All 12
> `FROM` across the 6 service Dockerfiles are now pinned inline to their
> multi-arch INDEX digest (`FROM rust:1.90-slim@sha256:...`, tag kept for
> readability; each digest amd64-verified against Docker Hub — prod host is
> amd64). This closes the "Docker layer reproducibility" v0.2.0 gap the
> reproducible-build CI stub deferred. `.github/dependabot.yml` (docker,
> monthly, grouped) re-pins each to the latest digest for its SAME tag so the
> pins stay CVE-current without going stale — so the digest table above is now
> maintained by Dependabot PRs, not the manual `inspect` recipe below. The
> capture recipe is kept for one-off checks / air-gapped verification.

To capture digests today:

```sh
for img in rust:1.90-slim debian:bookworm-slim oven/bun:1 oven/bun:1-slim oven/bun:1.2-alpine; do
  docker pull "$img" >/dev/null
  echo "$img → $(docker inspect "$img" --format='{{index .RepoDigests 0}}')"
done
```

---

## 2. Operator verification recipe

To independently rebuild and verify an engine release:

```sh
# 1. Check out the tagged release.
git clone https://github.com/lrafasouza/pegana.git
cd pegana
git checkout engine-v0.1.0

# 2. Build with locked deps.
cargo build --release --locked --frozen -p pegana-engine

# 3. Hash the binary.
sha256sum target/release/pegana-engine

# 4. Compare to the published checksum.
curl -fsSL https://releases.pegana.xyz/CHECKSUMS-engine-v0.1.0.txt | grep pegana-engine
```

A matching SHA proves you rebuilt the same artifact from the same source
the maintainers shipped. A mismatch is a flag — file an issue on
GitHub with the divergent hash + the runner spec (`uname -a`, rustc version,
glibc version).

For the `pegana-replay` CLI binary, the cargo-dist install script
(`releases.pegana.xyz/pegana-replay-installer.sh`) verifies Sigstore
attestations via `gh attestation verify` automatically.

---

## 3. CI stub

`.github/workflows/reproducible-build.yml` runs the same recipe on
`workflow_dispatch`:

1. Build the engine release.
2. Capture sha256.
3. Clean, rebuild.
4. Capture sha256 again.
5. Diff — fail if the two hashes differ.

The workflow is **manual-trigger only** for v0.1.0 — we don't want a
spurious cache-invalidation failure to block a PR while we calibrate the
recipe. Once it's been green on three consecutive maintenance runs, we
promote it to `on: pull_request` and gate merges on it.

Run it:

```sh
gh workflow run reproducible-build.yml --ref main
gh run watch
```

---

## 4. Known caveats

- **Same machine only.** Two CI runs on the same GitHub-hosted runner type
  produce identical hashes. Two runs across different runner types
  (`ubuntu-latest` ≠ `ubuntu-24.04-arm`) won't until we add
  `SOURCE_DATE_EPOCH` + deterministic linker flags. Tracked in v0.2.0.
- **Timestamp leakage.** Cargo embeds a build timestamp in some metadata
  sections. We rely on identical timestamps from rebuilding within seconds
  of each other; a more rigorous approach is to set `SOURCE_DATE_EPOCH` to
  the commit timestamp. Deferred to v0.2.0.
- **Docker layer caching.** The reproducible-build CI doesn't yet rebuild
  Docker images — it only rebuilds the Rust binary outside Docker. Image
  reproducibility is a separate workstream tracked alongside ABI pinning.

---

## 5. Cross-references

- Distribution spec: `docs/pegana-trust-layer-v0.1.0/10-distribution.md § 6`.
- Wave 11M plan: `docs/pegana-trust-layer-v0.1.0/plans/11-phase-11M-maximalist.md § Task 11M.7`.
- Sigstore attestations on the CLI: `docs/operations/releases-mirror.md`.
