# Security Policy

Pegana is a peg-risk oracle / Trust Layer for Solana. We take the integrity of our
verdicts and the safety of our infrastructure seriously.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security vulnerability.**

Report privately, and we'll acknowledge within 72 hours:

- **Preferred:** open a draft
  [GitHub security advisory](https://github.com/PeganaHQ/Pegana/security/advisories/new)
  on this repository (GitHub private vulnerability reporting). The advisory is private
  between you and the maintainers until it is published, and it is the route to a CVE if
  one is warranted.
- **Email:** [rafael@pegana.xyz](mailto:rafael@pegana.xyz). Use this if you cannot use
  GitHub, or if you have not heard back on an advisory within a week.
- Include: a description, the affected surface (API / web / MCP / CLI / on-chain), and
  steps to reproduce. A minimal PoC helps.

For the receipt verifier itself, the mirrored
[PeganaHQ/ReplayCLI](https://github.com/PeganaHQ/ReplayCLI/security/advisories/new) repository
accepts advisories too; either repository reaches the same maintainer.

We support coordinated disclosure and will credit reporters who want it.

## Scope

In scope: `www.pegana.xyz` (and `pegana.xyz`), `api.pegana.xyz`, `mcp.pegana.xyz`,
`docs.pegana.xyz`, the source in this repository (engine, API, indexers, MCP server, web
app), the public `pegana-replay` CLI, and the on-chain receipt/anchor mechanism. The
webhook egress path in `dispatcher-rs` is in scope for self-hosted deployments (the hosted
service does not offer webhook registration).

Out of scope: third-party dependencies' own advisories (report upstream), volumetric
DoS, and social engineering.

## What we've hardened (for context)

- **Webhook egress** is SSRF-guarded (5-layer `webhook_url` validation, no-redirect
  policy on every egress client, per-send DNS re-validation) — see the dispatcher.
- **Arithmetic** on untrusted on-chain / oracle data is checked (no `Decimal`
  overflow panics; decoders are bounds-checked + fuzzed).
- **Secrets** never land in logs (RPC URLs masked; a pre-commit cred-guard blocks
  `.env`/key dumps).

The public verifier (`pegana-replay`) re-derives any receipt byte-exact and checks the
on-chain anchor — so a swapped or forged verdict is detectable by anyone, not just us.
