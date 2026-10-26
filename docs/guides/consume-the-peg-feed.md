# Consume the Pegana peg feed

Pegana publishes a keyless, public peg-risk feed over REST. This guide gets you from zero to
interpreting a verdict in a few minutes. Full schema: the OpenAPI spec (`/openapi.json`) and
`docs/spec.html`.

## 1. List all tracked assets
```sh
curl -s https://api.pegana.xyz/v1/assets            # every tracked asset
curl -s "https://api.pegana.xyz/v1/assets?peg=USD"  # filter by peg target
curl -s "https://api.pegana.xyz/v1/assets?class=lst" # filter by class
```

## 2. Read the verdict (per asset)
| Field | Meaning |
|---|---|
| `state` | `PEGGED` / `DRIFT` / `DEPEG` / `CRITICAL` / `BLACK_SWAN` / `UNKNOWN` (treat as exhaustive) |
| `anchor` | what the peg is measured against: `USD` / `FX` / `NAV` |
| `risk_side` | `below` / `above` / `either` — which direction the risk is |
| `state_reason` | advisory machine-readable reason when present (e.g. `premium_sanity`, `stale_source`); omitted/`null` otherwise — explanatory only, never a verdict input |
| `discount` | signed market-vs-intrinsic spread |

Monetary/ratio values are exact decimal **strings** (parse as decimal, not float); timestamps are RFC3339 UTC millisecond-`Z`. See the [Response format](https://docs.pegana.xyz/guides/rest-api#response-format) conventions.

## 3. Poll cadence + limits
Poll `/v1/assets` no faster than once every few seconds; the feed updates on state transitions.
Rate limits apply per IP (see headers). For push instead of poll, use the WebSocket stream
(`wss://api.pegana.xyz/v1/ws` — SDK helpers `PegFeed` / `peg_feed`) or webhooks (`/account/webhooks`).

## 4. From an alert to a verifiable receipt
Every state transition ships a content-addressed receipt. Verify it with the CLI
(`cargo install pegana-replay; pegana-replay --alert-id <UUID>`) or in your browser — see
the "Verify in 60 seconds" guide. The receipt's `methodology_version` pins the CLI:
`cargo install pegana-replay` (latest) re-derives 0.5.0+ receipts; to verify a historical
0.4.0 receipt, pin the matching CLI with `cargo install pegana-replay@0.4.1`.

## Coverage
Every tracked asset: LSTs, stablecoins (incl. FX: BRZ→BRL, EURC→EUR), yield wrappers, CDPs,
synthetic-leverage tokens — all reproducible.
