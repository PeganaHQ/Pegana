# Licensing

Copyright 2026 Rafael Souza. The applicable license depends on the path:

| Path | License |
| --- | --- |
| `crates/engine-rs/`, `crates/indexer-rs/`, `crates/api-rs/`, `crates/dispatcher-rs/`, `crates/common/`, `crates/xtask/` | [FSL-1.1-MIT](LICENSE) |
| `mcp-ts/`, `protocol-indexer-ts/` | [FSL-1.1-MIT](LICENSE) |
| everything in this repository not listed above as MIT or proprietary (for example `ops/`, `scripts/`, `docker-compose*.yml`, `Caddyfile`, `migrations/`) | [FSL-1.1-MIT](LICENSE) |
| `crates/methodology/`, `crates/common-verify/`, `crates/pegana-replay-cli/` | [MIT](LICENSE-MIT), with a copy in each directory |
| `tools/pegana-replay-public/`, `sdk/typescript/`, `sdk/python/` | [MIT](LICENSE-MIT), with a copy in each directory |
| `METHODOLOGY.md`, methodology specification, `docs-site/` content, `docs/examples/` | [MIT](LICENSE-MIT) |
| `web/` and its design assets | Proprietary; not licensed for reuse (see the website terms) |
| Third-party fonts, token icons, and logos | Their owners' rights; see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) |

For each version of Pegana service code made available under FSL-1.1-MIT, the license changes to MIT on the second anniversary of that version's availability. Before then, the FSL permits any purpose other than a Competing Use, including internal use, non-commercial education and research, and professional services to licensees. A Competing Use is making the software available as a product or service that competes with Pegana or substitutes for it. The MIT parts may be used to build independent products under their MIT terms. The hosted API and MCP service remain free to use; that is a service policy, separate from the code licenses.

Every version published before this licensing change remains available under its original MIT license. The Pegana name and marks are governed separately by [TRADEMARK.md](TRADEMARK.md).

## Public repository history

The public repository at github.com/PeganaHQ/Pegana was re-initialised on 2026-10-26 with a single commit containing the current tree. The service code in that tree is under FSL-1.1-MIT, and the verifier, methodology and SDKs are under MIT. Earlier public history is no longer published.

Code that was published under MIT before the license change remains MIT for anyone who received it. The open-track packages (pegana-replay, pegana-methodology, pegana-common-verify and the SDKs) are unaffected and stay MIT.
