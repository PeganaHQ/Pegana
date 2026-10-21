# Runbook: PeganaHQ/Pegana repository settings (owner-run)

These are GitHub repository settings, not code. They cannot be changed from a
branch, so the repo owner runs them once with an admin-scoped `gh` session.
Each entry lists the read-only check, the change, and the verification.

State recorded on 2026-10-20 (read-only `gh api` calls).

## 1. Public CI hits `startup_failure` on every push and PR

**Cause.** `repos/PeganaHQ/Pegana/actions/permissions` returns
`allowed_actions=selected` and `sha_pinning_required=true`. The selected-actions
list allows GitHub-owned actions plus only these patterns:

```
actions/checkout@*  actions/setup-node@*  actions/setup-python@*
github/codeql-action/*@*  dependabot/fetch-metadata@*  dorny/paths-filter@*
```

with `verified_allowed=false`. `.github/workflows/ci.yml` also uses three
third-party actions that are not on that list, so GitHub refuses to start the
run:

- `dtolnay/rust-toolchain` (rust, verify-assets, audit-rust)
- `Swatinem/rust-cache` (rust, verify-assets, audit-rust)
- `oven-sh/setup-bun` (mcp-ts, protocol-indexer-ts, audit-protocol-indexer, web)

All three are already SHA-pinned in `ci.yml`, so `sha_pinning_required` is
satisfied once they are allowed. `actions/github-script` and
`actions/upload-artifact` are GitHub-owned and already allowed.

**Check (read-only):**

```bash
gh api repos/PeganaHQ/Pegana/actions/permissions
gh api repos/PeganaHQ/Pegana/actions/permissions/selected-actions
gh run list -R PeganaHQ/Pegana --limit 5
```

**Fix, option A (recommended): extend the allowlist.** The PUT replaces the
whole list, so every existing pattern is repeated:

```bash
gh api -X PUT repos/PeganaHQ/Pegana/actions/permissions/selected-actions \
  -F github_owned_allowed=true \
  -F verified_allowed=false \
  -f 'patterns_allowed[]=actions/checkout@*' \
  -f 'patterns_allowed[]=actions/setup-node@*' \
  -f 'patterns_allowed[]=actions/setup-python@*' \
  -f 'patterns_allowed[]=github/codeql-action/*@*' \
  -f 'patterns_allowed[]=dependabot/fetch-metadata@*' \
  -f 'patterns_allowed[]=dorny/paths-filter@*' \
  -f 'patterns_allowed[]=dtolnay/rust-toolchain@*' \
  -f 'patterns_allowed[]=Swatinem/rust-cache@*' \
  -f 'patterns_allowed[]=oven-sh/setup-bun@*'
```

**Fix, option B:** drop those three actions from `.github/workflows/ci.yml`
(install Rust with `rustup` and bun with its install script in plain `run:`
steps, and remove caching). That is a code change and goes through a normal
branch.

**Verify:** re-run the latest CI run (`gh run rerun <id> -R PeganaHQ/Pegana`)
or push the next change; the run must reach its jobs instead of ending in
`startup_failure`. `selected-actions` must list the three new patterns.

## 2. Private vulnerability reporting is disabled

**Cause.** `SECURITY.md` and `CONTRIBUTING.md` point researchers at GitHub
private vulnerability reporting, but
`gh api repos/PeganaHQ/Pegana/private-vulnerability-reporting` returns
`{"enabled":false}`, so the "Report a vulnerability" button does not exist yet.
Until it is enabled, the email route in `SECURITY.md` is the working channel.

**Fix:**

```bash
gh api -X PUT repos/PeganaHQ/Pegana/private-vulnerability-reporting
```

**Verify:** the same GET returns `{"enabled":true}` and
`https://github.com/PeganaHQ/Pegana/security/advisories/new` opens the private
report form.

`scripts/harden-github.sh tier1` already does this for `PeganaHQ/ReplayCLI`;
it does not touch `PeganaHQ/Pegana`.
