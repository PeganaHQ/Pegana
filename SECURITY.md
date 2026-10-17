# Security Policy

Pegana is a peg-risk oracle / Trust Layer for Solana. We take the integrity of our
verdicts and the safety of our infrastructure seriously.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security vulnerability.**

Report privately, and we'll acknowledge within 72 hours:

- **Preferred:** open a draft
  [GitHub security advisory](https://github.com/lrafasouza/pegana/security/advisories/new)
  on this repository. The advisory is private between you and the maintainers until it
  is published.
- Include: a description, the affected surface (API / web / CLI / on-chain), and steps
  to reproduce. A minimal PoC helps.

We support coordinated disclosure and will credit reporters who want it.

## Scope

In scope: `pegana.xyz` and `api.pegana.xyz`, the public `pegana-replay` CLI, the
webhook egress path, and the on-chain receipt/anchor mechanism.

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
