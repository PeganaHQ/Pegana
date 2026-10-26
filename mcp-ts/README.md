# pegana-mcp

TypeScript MCP server that exposes Pegana's peg-risk oracle for Solana to AI
agents via the [Model Context Protocol](https://modelcontextprotocol.io/).
Every tool is free: no API key, no signup, no payment.

Hosted at `https://mcp.pegana.xyz` (Streamable HTTP, stateless). No clone
needed; point your MCP client at the URL:

```json
{ "mcpServers": { "pegana": { "url": "https://mcp.pegana.xyz/" } } }
```

Docs: [docs.pegana.xyz/guides/mcp](https://docs.pegana.xyz/guides/mcp).
Machine-readable manifest: `GET https://mcp.pegana.xyz/.well-known/mcp.json`.

## Tools

All ten tools are free and declare an `outputSchema`; `structuredContent`
always matches it exactly (enforced by a test that validates every tool's
real output with the official MCP SDK client).

| Name | Returns |
|---|---|
| `ping` | `pong (Ns)` + server uptime |
| `ping_paid` | `paid pong`; legacy alias of `ping`, name kept for compatibility |
| `get_assets` | Every active tracked asset, the same set and count as REST `/v1/assets`: state, discount, intrinsic, market, `ts`, `updated_at`, `stale`. An asset with no live snapshot is listed as `UNKNOWN` with null values and `stale: true`. Leveraged synthetics (`synth_lev`, xSOL) are excluded, as in REST |
| `get_asset_state(symbol)` | Current snapshot for one asset (errors if older than 15 min) |
| `get_methodology(symbol)` | How this asset's intrinsic and market prices are sourced, plus the state machine (errors if not tracked) |
| `get_loop_exposure(symbol)` | Anonymous aggregate cross-protocol leverage exposure (advisory) |
| `simulate_depeg_impact(symbol, shock_bps)` | Estimated liquidation cascade for a preset shock (advisory). `liquidatable_usd` is the total collateral of the bands that liquidate, so it can exceed `loop_exposure_usd`; it and `positions` may be null when coverage is unknown (amount not known, not zero) |
| `verify_alert(alert_id)` | Fetches the public audit receipt for an alert as the API serves it, with replay bundle URL and on-chain anchor status. It recomputes no hash and checks no anchor; verify independently with the `pegana-replay` CLI (below) |
| `get_asset_history(symbol, bucket, limit)` | Time-bucketed discount series (1m / 5m / 15m / 1h, up to 5,000 rows, 7-day lookback; USD legs are the last observation per bucket) |
| `subscribe_peg_events(symbols, since_ts, threshold_bps?)` | Batch of state-transition events since a lossless cursor, each with `evidence_url` and `evidence_status` (`ready`, `pending`, `failed_permanent` or `missing`; some alerts have no persisted receipt, and a just-created alert can show `missing` for a moment before its receipt lands). An unknown symbol is an `isError` naming it, not an empty batch |

`discount` is `1 - market/intrinsic`, signed: negative means the asset trades
above intrinsic (a premium), positive means below (a discount). Decimals and
timestamps use the same formats as the REST API (`api.pegana.xyz`).

Where the data comes from:

- `get_assets`, `get_asset_state`: an in-memory cache filled by a Redis
  SUBSCRIBE on `pegana:discount` (engine-rs publishes every recompute).
  `get_assets` takes its asset list from the registry below, so an active
  asset without a live snapshot still appears (as `UNKNOWN`).
- `get_asset_history`, `subscribe_peg_events`: Postgres
  (`discount_snapshots`, `alert_events`; `evidence_status` reads
  `alert_evidence` and `alert_evidence_pending`).
- `get_loop_exposure`, `simulate_depeg_impact`, `verify_alert`: proxied from
  api-rs, so they return the same model as REST.
- `get_methodology`: `src/shared/asset-registry.ts`, generated from the
  repo-root `assets.toml` (`bun run scripts/gen-asset-registry.ts`; a test
  fails on drift).

## Limits

- 100 tool calls per minute per client IP, enforced in-app (ADR-0011
  `withRateLimit`, keyed only on the proxy-set client IP), with usage
  telemetered to `mcp_call_log`. There is no Caddy-level rate limit.
- 300 JSON-RPC messages per minute per client IP, counted in the transport
  before any message runs: every message counts, including each entry of a
  batch, `initialize`, `tools/list`, notifications and calls that fail
  validation. Over the limit the reply is HTTP 429 (`Retry-After: 60`) with
  a JSON-RPC error (`-32000`, `data.error: "rate_limited"`). A `tools/call`
  counts against both limits.
- A JSON-RPC batch holds at most 10 entries. A larger batch is refused as a
  whole, before any entry runs, with one HTTP 400 JSON-RPC error (`-32600`,
  "batch too large").
- Request bodies are capped at 64 KB: above that the reply is HTTP 413 with
  a JSON-RPC error (`-32600`), whether the body has a Content-Length or is
  chunked.
- Only `POST /` speaks JSON-RPC. The server is stateless with no SSE stream
  and no sessions, so `GET /` asking for `text/event-stream` and
  `DELETE`/`PUT`/`PATCH /` get HTTP 405 with `Allow: POST`.
- Tool arguments are validated strictly: symbols must be 1-20 chars of
  `[A-Za-z0-9._+*-]`, `since_ts` is unix seconds in `[0, 1e10]`, and an
  unknown argument key is rejected (the schemas say
  `additionalProperties: false`). Internal errors come back as a generic
  message, never the raw database or upstream text.
- A proxied 429 from api-rs is returned as
  `{"error":"rate_limited","upstream":...,"retry_after_seconds":N}`, the same
  shape as this server's own limit.
- The REST-proxy tools are also subject to the api-rs per-IP limit; mcp-ts
  forwards the caller's IP so each caller has its own upstream bucket.

## Env

| Variable | Purpose |
|---|---|
| `REDIS_URL` | Redis with the `pegana:discount` channel |
| `DATABASE_URL` | Postgres/TimescaleDB (read-only use) |
| `SOLANA_NETWORK` | CAIP-2 network id, e.g. `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet) |
| `PEGANA_API` | api-rs base URL for the proxy tools (compose: internal `http://api:8080`) |
| `PEGANA_PUBLIC_API` | Public API base used in links returned to agents (default `https://api.pegana.xyz`) |
| `AUDIT_BASE_URL` | Base of the public audit pages in `evidence_url` (default `https://pegana.xyz`) |
| `HTTP_PORT` | Listen port (default 8090) |
| `X402_FACILITATOR_TIMEOUT_MS` | Optional. Per-request timeout for the x402 facilitator, a positive integer in ms (default 5000). An invalid value falls back to the default |

There is no payment receiver, facilitator credential or payer key to
configure.

## Running

```
bun install
bun dev              # watch mode, port 8090
bun start            # one-shot
bun run typecheck
bun run lint
bun run test         # unit suite (in-memory; mocks Postgres, Redis and fetch)
```

Run tests with `bun run test` (vitest), not `bun test`.

Production runs in Docker: see `Dockerfile` and the `mcp-ts` service in the
repo-root `docker-compose.yml`.

## Architecture

```
engine-rs ── pegana:discount (Redis) ──▶ pegana-mcp ◀── AI agents
Postgres  ── history, alert_events  ──▶ (this pkg)      (Claude, Cursor, custom)
api-rs    ── loop, simulate, audit  ──▶
```

The MCP server is a stateless read-through layer: it never writes to the
engine and never publishes back, so a failure here cannot corrupt the
oracle's state.

## Verifying a receipt

`verify_alert` is a convenience fetch: it returns the receipt exactly as
`GET /v1/audit/{id}` serves it and does no checking of its own. To verify a
receipt independently, run the open-source `pegana-replay` CLI on your own
machine:

```
cargo install pegana-replay --locked
pegana-replay --alert-id <uuid>
```

It re-hashes the frozen inputs and verdict, compares the result to
`receipt_sha256`, and checks that the on-chain memo anchor carries that hash
and was signed by Pegana's pinned ops wallet (`--offline` skips the on-chain
check; `--bundle <file>` verifies a downloaded replay bundle).

## See also

- Verifier (methodology, replay CLI, common-verify):
  [github.com/PeganaHQ/ReplayCLI](https://github.com/PeganaHQ/ReplayCLI)
- ADR-0011 (free tools with telemetry), ADR-0036 (loop data boundary) in
  `docs/adr/`
