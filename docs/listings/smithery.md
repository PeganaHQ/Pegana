# Smithery.ai — Pegana submission

**Status:** ✅ Ingested 2026-05-27 — server live at
`https://smithery.ai/server/pegana/pegana-oracle`. Visibility: **unlisted**
(operator can flip to public via "Change visibility" once ready for broad
discovery). Tools and metadata auto-pulled from `mcp.pegana.xyz` —
no manual field filling required for re-ingest.

## Submission template

- **Name:** `pegana-oracle`
- **Tagline:** "The peg-risk oracle for Solana. Real-time peg state for 22 active LSTs, stablecoins, yield-bearing, CDPs, and synthetics."
- **Endpoint:** `https://mcp.pegana.xyz`
- **Transport:** Streamable HTTP (Web Standard)
- **License:** MIT
- **Source:** https://github.com/lrafasouza/pegana
- **Docs:** https://pegana.xyz/developers#mcp

## Tool catalog

| Tool | Free / Paid | Description |
|---|---|---|
| `ping` | free | Health check, returns `pong (Ns)` |
| `get_assets` | free | List all tracked assets with current peg state |
| `get_asset_state(symbol)` | free | Current state + discount + intrinsic + market for one asset |
| `get_methodology(symbol)` | free | Per-asset peg-mechanism explainer |
| `ping_paid` | $0.001 | Smoke test for x402 wiring |
| `get_asset_history(symbol, bucket, limit)` | $0.001 | Time-series of discount over 1m / 5m / 15m / 1h buckets |
| `subscribe_peg_events(symbols, since_ts, threshold_bps?)` | $0.0005 | Batch of state-transition AlertEvents since cursor |

## Pricing

Paid tools are metered per-call via [x402](https://x402.org/) — the agent
pays USDC on Solana mainnet directly to a receiver address, no API keys /
signups / monthly minimums. First mainnet settlement landed
2026-05-27 (tx `tibrTH1UetZ1fyRNMpb31bz5JHLZ3Bj4uKmShFVM7TDDKtZ3EhxUV9r7eLhUZ24jHxLx86t6b3nN4AiTgZKapsP`);
ongoing devnet soak is in `docs/CALIBRATION-v2-mcp-spike.md`.

## Submission process (historical reference)

For future MCPs / re-listing on other directories:
1. Visit https://smithery.ai → "Add server"
2. Smithery auto-pulls metadata from the endpoint — no manual fields
3. Capture the namespaced URL

### Submission 2026-05-27

- Listing URL: https://smithery.ai/server/pegana/pegana-oracle
- Namespace: `pegana` (changed from initial `rafinha-lima1` for brand match)
- CLI install (once listed public):
  ```
  smithery mcp add pegana/pegana-oracle
  ```
- Status: ingested, **unlisted** until operator flips visibility public
- Notes: Smithery auto-discovered all 8 tools (5 free + 3 paid). Free tier
  works without a Smithery API key; paid tools route x402 through the
  agent's wallet, not through Smithery.
