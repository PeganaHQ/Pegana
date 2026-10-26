# Contributing

Pegana has MIT-licensed open components and FSL-1.1-MIT service components.
The pegana.xyz website and its design system are proprietary; see
[LICENSING.md](LICENSING.md) and [TRADEMARK.md](TRADEMARK.md).
Issues and pull requests on the oracle are welcome on
[github.com/PeganaHQ/Pegana](https://github.com/PeganaHQ/Pegana).

## Before you open something

- **Security vulnerabilities**: do not open a public issue. Follow [SECURITY.md](SECURITY.md)
  (GitHub private vulnerability reporting, or email rafael@pegana.xyz).
- **A verdict you disagree with**: open an issue with the alert id and, if you can, the
  `pegana-replay` output that disagrees. Disputing a verdict is the intended use of the
  receipts, not a complaint.
- **Methodology changes** (anything under `crates/methodology/` that can move a verdict):
  open an issue first. Methodology decisions are recorded as ADRs under `docs/adr/`, and the
  methodology version is part of every receipt, so a change to the math needs an ADR and a
  version bump rather than a silent edit.

## Making a change

Read the [README](README.md) for the repository layout and the commands. The short
version of the gates a pull request must pass:

```bash
# Rust workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets

# TypeScript packages (mcp-ts, protocol-indexer-ts): from the package directory
bun run typecheck
bun run lint
bun run test
```

House rules:

- Everything written into the repository is in English: code, comments, commit messages,
  docs and user-facing copy.
- Never edit an already-applied migration under `migrations/`; add a new, higher-numbered one.
- Data shown to users must be real. Do not hardcode or invent values in UI or docs examples
  that could be read as live data.

## How changes land

Pull requests are reviewed on PeganaHQ/Pegana. `main` is updated through maintainer sync pull
requests, so an accepted contribution may land as part of a sync PR (credited to you) rather
than by merging your PR directly. The verifier subset of this repository
(`crates/methodology/`, `crates/pegana-replay-cli/`, `crates/common-verify/`, `assets.toml`
and `tools/pegana-replay-public/`) is mirrored automatically to
[PeganaHQ/ReplayCLI](https://github.com/PeganaHQ/ReplayCLI), so changes to those paths are
made here, not in the mirror.

## Conduct

See [tools/pegana-replay-public/CODE_OF_CONDUCT.md](tools/pegana-replay-public/CODE_OF_CONDUCT.md),
which applies to both repositories. Report conduct issues to rafael@pegana.xyz.

## Licensing of contributions

Contributions to MIT paths listed in [LICENSING.md](LICENSING.md) are submitted under MIT. Contributions to FSL paths are submitted under FSL-1.1-MIT, and the contributor grants Rafael Souza the right to relicense those contributions. This keeps contributions under the receiving track's license while allowing the owner to publish future licenses.

Sign off each commit using the Developer Certificate of Origin format:

```text
Signed-off-by: Your Name <you@example.com>
```

The sign-off certifies that you have the right to submit the contribution under these terms. The Pegana marks remain subject to [TRADEMARK.md](TRADEMARK.md).
