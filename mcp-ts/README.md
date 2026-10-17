# pegana-mcp

TypeScript MCP server that exposes Pegana's peg-risk oracle to AI agents
via the [Model Context Protocol](https://modelcontextprotocol.io/),
metered per-call in USDC on Solana through
[x402](https://x402.org/).

Hosted at `https://mcp.pegana.xyz` — no clone needed; point your MCP client at the
URL. The verifier source (methodology, replay CLI, common-verify) is public at
[pegana-replay](https://github.com/PeganaHQ/ReplayCLI).

## Tools

| Name | Free / Paid | Returns |
|---|---|---|
| `ping` | free | `"pong (Ns)"` + server uptime |
| `get_assets` | free | List of all tracked assets with current state |
| `get_asset_state(symbol)` | free | Current peg state + discount + intrinsic + market for one asset (5-min stale gate) |
| `get_methodology(symbol)` | free | Per-class peg-mechanism explainer + link to /methodology |
| `get_loop_exposure(symbol)` | free | Anonymous aggregate cross-protocol leverage exposure (advisory) |
| `simulate_depeg_impact(symbol, shock_bps)` | free | Estimated liquidation cascade for a preset depeg shock (advisory) |
| `verify_alert(alert_id)` | free | Verify an alert receipt and optional on-chain anchor |
| `ping_paid` | **$0.001** | `"paid pong"` — smoke test for x402 wiring |
| `get_asset_history(symbol, bucket, limit)` | **$0.001** | Time-bucketed discount series (1m / 5m / 15m / 1h) |
| `subscribe_peg_events(symbols, since_ts, threshold_bps?)` | **$0.0005** | Batch of AlertEvents since cursor |

Free tools answer from an in-memory cache filled by a Redis SUBSCRIBE on
`pegana:discount`. Paid tools hit Postgres (history) or `alert_events`
(subscribe).

## Stack (pinned)

- `@modelcontextprotocol/sdk@^1.30.0` (canonical stable; `@x402/mcp` pins `sdk@^1.12.1`)
- `@x402/mcp@^2.13.0` + `@x402/svm@^2.13.0` + `@x402/core@~2.13.0`
- `@solana/kit@^5.1.0`
- `hono@^4.12.32` (Web Standard transport via `WebStandardStreamableHTTPServerTransport`)
- `ioredis@^5.4.0`, `pg@^8.13.0`, `zod@^3.24.2`
- Bun runtime

## Env

See `.env.example`. Two CAIP-2 networks matter:

```
devnet:  solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
mainnet: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
```

Every tool is free: there is no payment receiver, no facilitator credential
and no payer key to configure. The only env the server needs is `REDIS_URL`,
`DATABASE_URL` and `SOLANA_NETWORK`.

## Quota model (v2)

- **Free tools** (`ping`, `get_assets`, `get_asset_state`, `get_methodology`,
  `get_loop_exposure`, `simulate_depeg_impact`, `verify_alert`): no per-caller
  billing. Rate-limited **in-app** to 100 req/min/agent (ADR-0011
  `withRateLimit`, fingerprinted by source IP), with usage telemetered to
  `mcp_call_log`. There is **no** Caddy-level rate limit.
- **Paid tools** (`ping_paid`, `get_asset_history`, `subscribe_peg_events`):
  metered by x402 per call. **No free tier for paid tools in v2** — the agent
  always pays. `subscribe_peg_events` carries the same in-app
  100/min/agent cap on top of payment; `get_asset_history` and
  `ping_paid` are gated by x402 payment alone.

The originally-specced "1000 free calls/day per payTo" (SPEC decision #6)
is **descoped to v2.1** once we have telemetry to define a sane default.
The counter infra (`src/quota.ts`) exists and is unit-tested; wiring
into a middleware on the paid tools is a v2.1 change.

## Running

```
bun install
bun dev           # watch mode, port 8090
bun start         # one-shot
bun run typecheck
bun test          # unit suite (in-memory; mocks @/db, @/redis, fetch)
bun run test:devnet  # self-skips unless the devnet env is set
```

Production runs in Docker — see `Dockerfile` and the `mcp-ts` service
in the repo-root `docker-compose.yml`.

## Architecture

```
        ┌─ pegana:discount ─────┐
engine-rs (publishes)            │ SUBSCRIBE
        └─ pegana:alerts ───────┘
                                 ▼
                         ┌───────────────┐
                         │  pegana-mcp   │ ── x402 facilitator (x402.org)
                         │  (this pkg)   │      ▲
                         └───────────────┘      │ USDC settlement
                                 ▲              │ on Solana mainnet
                                 │              │
                            AI agents ──────────┘
                            (Claude Desktop, custom)
```

The MCP server is a stateless read-through layer — it never writes to
the engine, never publishes back. Failure here cannot corrupt the
oracle's state.

## See also

- SPEC: `docs/superpowers/specs/2026-05-26-pegana-v2-a2-oracle-reframe-design.md`
- Plan 2: `docs/superpowers/plans/2026-05-26-pegana-v2-phase-2-channels.md`
- Calibration: `docs/CALIBRATION-v2-mcp-spike.md`
