# Phase 1 + Phase 2 code review

**Date:** 2026-05-27  
**Scope:** v2 Phase 1 foundation, Phase 2 MCP + webhook channels, launch-readiness evidence.  
**Verdict:** Phase 3A launch prep is allowed. Phase 3B public launch is not validated yet.

## Findings

### P0 - Webhook registration allows SSRF-shaped targets

`crates/api-rs/src/routes/webhooks.rs` only checks that URLs start with
`https://` and contain a non-empty host. `crates/dispatcher-rs/src/webhook.rs`
then posts to that URL from backend infrastructure.

Impact: an authenticated user can register URLs that resolve to private,
loopback, metadata, or otherwise internal addresses if DNS points there. This
turns the dispatcher into an internal network request primitive.

Fix before public self-service:
- parse URLs with a URL parser;
- require `https`;
- resolve DNS at dispatch time;
- reject loopback, private, link-local, multicast, documentation, and metadata
  ranges;
- optionally route webhook egress through an isolated proxy.

### P1 - MCP paid-call path is not fully proven

The MCP package exists and local tests pass, but the devnet integration test
only checks the 402 envelope and explicitly leaves the signed payment retry as
TODO. `docs/CALIBRATION-v2-mcp-spike.md` still marks the 24h devnet soak and
first mainnet paid call as pending.

Do not claim "paid tools settle via x402 on Solana mainnet" until:
- devnet 402 -> pay -> retry succeeds;
- 24h devnet soak is recorded;
- first mainnet paid call has a Solana tx signature.

### P1 - MCP boot accepts empty payment receiver

`mcp-ts/src/server.ts` reads `PEGANA_PAYTO_USDC` with `?? ""` and then builds
payment requirements. This should fail fast with a clear startup error instead
of letting a misconfigured paid MCP server boot with an empty payment receiver.

Fix: validate `PEGANA_PAYTO_USDC` at startup, including network-appropriate
address format.

### P1 - Phase 1 calibration is not done

The Phase 1 frontend work is substantially complete, but the Phase 1 launch
gate is calibration. `docs/CALIBRATION-v1.md` is currently a pending template:
no dates, no samples, no p95/p99, no threshold deltas, no launch verdict.

Public launch should wait until the 14-day dogfood window is complete.

### P2 - Marketing copy is ahead of evidence

`web/app/(marketing)/developers/page.tsx` says paid tools settle on-chain via
x402 in USDC on Solana mainnet. The evidence docs still show that mainnet
payment proof is pending.

For Phase 3A copy, use "x402 payment path is in verification." Upgrade the copy
only after the mainnet tx proof is recorded.

### P2 - Landing performance misses its own gate

The production Lighthouse record has `/` at performance 80 against a target of
85. Accessibility passed, `/developers` passed, but the landing hero still
misses the performance target due to LCP and unused JavaScript.

This is not a blocker for private outreach, but it should be fixed before a
large public launch.

## What appears solid

- Phase 1 marketing/oracle/developers pages were deployed and sanity-checked.
- Accessibility baseline is green in the recorded launch report.
- API rate-limit extraction now has tests for `X-Forwarded-For` behavior.
- Dispatcher webhook signatures have unit coverage for valid, tampered-body,
  tampered-timestamp, and malformed-signature cases.
- MCP unit tests pass for free tool shapes and quota behavior.
- `mcp-ts` TypeScript typecheck passes.
- Security remediation notes for the prior audit now match many code changes:
  Redis auth in compose, CORS allowlist, JWT secret minimum, bot constant-time
  compare, and committed Bun lockfile.

## Verification run

Commands executed locally:

```bash
cargo test -p dispatcher-rs --test webhook_signing
cargo test -p api-rs rate_limit
cd mcp-ts && bun test
cd mcp-ts && bun run typecheck
```

Results:
- dispatcher webhook signing: 4 passed;
- API rate-limit tests: 7 passed;
- MCP tests: 5 passed, 2 skipped;
- MCP typecheck: passed.

Skipped/remaining:
- x402 devnet end-to-end paid retry is skipped without funded env and still has
  a TODO for full signed-payment retry;
- webhook receiver matrix is gated behind `PEGANA_RUN_RECEIVER_TESTS=1`;
- no API route tests were found for `/v1/me/webhooks`;
- no production smoke test was run in this review.

## Release call

Phase 1 and Phase 2 are implemented enough to continue Phase 3A: docs,
screenshots, private outreach, integration checklist, and quiet partner demos.

They are not fully validated for Phase 3B public launch. The minimum remaining
fixes are webhook SSRF protection, MCP payTo fail-fast validation, x402 paid
call proof, webhook dogfood proof, and calibration completion.
