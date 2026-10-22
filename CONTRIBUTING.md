# Contributing

Pegana is open-core: the oracle in this repository is open source under the MIT license.
The pegana.xyz website and its design system are proprietary and not part of this repository
(see the License section of [README.md](README.md) and [TRADEMARKS.md](TRADEMARKS.md)).
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

## License

By contributing you agree that your contributions to the oracle are released under the MIT
license (see [LICENSE](LICENSE)). The MIT license does not cover the Pegana name, logo or
wordmark (see [TRADEMARKS.md](TRADEMARKS.md)).
