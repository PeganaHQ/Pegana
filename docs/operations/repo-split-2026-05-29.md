# Repo split — pegana / pegana-replay (2026-05-29)

## Summary

The Pegana code is split across two GitHub repos:

| Repo | Visibility | Source-of-truth for |
|---|---|---|
| `lrafasouza/pegana` (this one) | **private** | engine, dispatcher, indexer, API, MCP server, Telegram bot, on-chain commit pipeline, web (Next.js site), runbooks, infra config, **and** all the public-mirrored code |
| `lrafasouza/pegana-replay` | **public** | mirror of `crates/methodology`, `crates/pegana-replay-cli`, `crates/common-verify`, `assets.toml`, `docs/adr/`. Hosts the cargo-dist release workflow (4 platforms + Sigstore). |

The private repo remains the **only place anyone commits.** The public repo is
a derived artifact: a GitHub Action in this repo
(`.github/workflows/sync-pegana-replay.yml`) does a path-filtered subtree-push
to `pegana-replay/main` whenever any whitelisted path changes on `main`.

## Why split

The Trust Layer pitch ("every alert ships with a verifiable receipt anyone can
replay") depends on the methodology code being readable. With the whole repo
private, `cargo install --git` failed for external users, `gh attestation
verify` couldn't validate Sigstore-signed binaries, and every `View source`
link on the site 404'd — making the trust narrative hollow.

Carving the receipt-validation surface out into a public repo preserves the
trust narrative without exposing the operational stack (engine math, threshold
calibration tuning, indexer adapters, webhook signing keys, bot internals).

See the Q1-Q15 design pass and `docs/superpowers/plans/` for the full analysis
that led here.

## File map

### What lives in the public mirror

| Public path | Private source | Why public |
|---|---|---|
| `assets.toml` | `assets.toml` | Hashed into every audit receipt. Required to replay. |
| `crates/methodology/` | `crates/methodology/` | The pure functions every alert is a function of. |
| `crates/pegana-replay-cli/` | `crates/pegana-replay-cli/` | The verifier binary itself. |
| `crates/common-verify/` | `crates/common-verify/` | Config types + AlertEvidence schema needed to parse receipts. |
| `docs/adr/` | `docs/adr/` | Every methodology decision is dated + rationalised. |
| `README.md` | `tools/pegana-replay-public/README.md` | Visitor-facing pitch. |
| `LICENSE` | `tools/pegana-replay-public/LICENSE` | MIT. |
| `CONTRIBUTING.md` | `tools/pegana-replay-public/CONTRIBUTING.md` | Mirror disclosure + routing-via-Telegram. |
| `Cargo.toml` (workspace) | `tools/pegana-replay-public/Cargo.toml` | Workspace declaration with only the 3 carved crates + a complete `workspace.metadata.dist` block. |
| `.gitignore` | `tools/pegana-replay-public/.gitignore` | target/, IDE noise. |
| `.github/workflows/release.yml` | `tools/pegana-replay-public/release.yml` | cargo-dist 0.30.0 release pipeline (4 targets, Sigstore via OIDC, axodotdev installer URL, allow-dirty=ci). |

### What stays private

Everything else, notably:

- `crates/api-rs/`, `crates/engine-rs/`, `crates/dispatcher-rs/`, `crates/indexer-rs/`
- `crates/common/` (server-side runtime types; the carve-out re-exports
  `pegana-common-verify` so existing `use pegana_common::Foo` paths in
  internal code keep resolving)
- `bot-ts/`, `mcp-ts/`, `web/`
- `docs/operations/`, `docs/security/`, `Caddyfile`, `docker-compose.yml`,
  `scripts/`, everything in `infra/`

## How sync runs

Trigger: push to `main` that touches any whitelisted path, OR manual
`workflow_dispatch` from the Actions UI / `gh workflow run`.

The action (`sync-pegana-replay.yml`):

1. `actions/checkout@v5` with `fetch-depth: 0` (full graph for subtree-split).
2. For each whitelisted **directory** (`crates/common-verify`,
   `crates/methodology`, `crates/pegana-replay-cli`, `docs/adr`):
   `git subtree split --prefix=<dir>` to produce a synthetic linear history
   containing just that subtree.
3. `git read-tree --empty` → `git read-tree --prefix=<dir>/ <tree>` for each
   split to assemble the public tree.
4. `assets.toml` is a **single file** — subtree split errors on non-directory
   paths, so it's overlaid directly via `git hash-object -w` +
   `git update-index --cacheinfo`.
5. The 6 orchestration files from `tools/pegana-replay-public/` are overlaid
   into their canonical positions (root for README/LICENSE/CONTRIBUTING/
   Cargo.toml/.gitignore; `.github/workflows/release.yml` for the release
   pipeline).
6. `git commit-tree` produces an orphan-friendly commit (chains onto the
   existing `pegana-replay/main` if present).
7. `git push --force` to `pegana-replay/main` using the PAT stored in
   `secrets.PEGANA_REPLAY_PUSH_TOKEN` via the canonical
   `https://x-access-token:<TOKEN>@github.com/...` URL form.

**Force push is intentional.** The public history is fully derived from
private; there's no human-authored work on `pegana-replay/main` to preserve.
Treat the public branch as a build artifact.

## PAT setup (one-time)

- Token type: Fine-Grained PAT or Classic with `repo` scope. **Fine-Grained
  requires Contents: Read AND Write** — without write, the diagnostic step in
  the action proves the same token can read but cannot mutate refs (the actual
  failure mode hit during initial setup on 2026-05-29).
- Token URL: `https://github.com/settings/personal-access-tokens` (Fine-Grained)
  or `https://github.com/settings/tokens` (Classic).
- Stored as `gh secret set PEGANA_REPLAY_PUSH_TOKEN -R lrafasouza/pegana`.
- Expiration: set to 90 days by convention; rotate when it expires (the
  action will start failing with the same "Resource not accessible" message
  the diagnostic step surfaces).

## Releases

Releases live **only** in `pegana-replay`. To cut v0.1.0:

```sh
# In a clone of the PUBLIC repo:
git clone https://github.com/lrafasouza/pegana-replay
cd pegana-replay
git tag -a v0.1.0 -m "v0.1.0 — ..."
git push origin v0.1.0
```

This fires `release.yml` in the public repo, which:

- builds 4 targets (linux x86_64, macos x86_64, macos aarch64, windows x86_64)
  via `dist build`
- attests each binary's provenance via `actions/attest-build-provenance@v2`
  (Sigstore signed by GitHub's OIDC issuer for `lrafasouza/pegana-replay`)
- uploads the binaries to a public GitHub Release

Anyone (no auth required) can then:

```sh
curl -fsSL https://releases.pegana.xyz/pegana-replay-installer.sh | sh
gh attestation verify ~/.pegana/bin/pegana-replay \
  --owner lrafasouza --repo pegana-replay
```

The private repo has **no release workflow** — the obsolete
`.github/workflows/release.yml` was deleted in this same change so duplicate
runs can't happen.

## Operations notes

- **Editing methodology:** commit normally in this (private) repo. The sync
  action will mirror to the public repo on push.
- **Adding a new ADR:** drop a `docs/adr/NNNN-*.md` file as usual — the sync
  whitelist includes `docs/adr/**`.
- **Changing public-only files** (README, CONTRIBUTING, LICENSE, the public
  Cargo.toml): edit `tools/pegana-replay-public/` here in the private repo.
  The sync action overlays them at the right public paths.
- **Methodology version bump:** add a `methodology-vX.Y.Z` tag in the public
  repo (same workflow as `v*`). Receipts reference this exact tag.
- **Test the sync without an actual content change:** trigger via UI or
  `gh workflow run sync-pegana-replay.yml -R lrafasouza/pegana`.

## Audit / verification trail

Each sync commit on `pegana-replay/main` is authored by `pegana-sync-bot
<ops+sync@pegana.xyz>` and reproduces the contents of a specific private
commit referenced in its message body. To audit a public commit:

1. Note the private commit SHA from the public commit message.
2. In this (private) repo, `git show <sha>` shows what changed.
3. Compare against the public-tree content — they should diverge only in the
   sense that the public commit lacks the non-whitelisted files.
