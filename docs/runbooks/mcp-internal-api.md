# Runbook: mcp-ts upstream on the internal api-rs (R1 audit idx 86)

## Why

mcp-ts proxies `get_loop_exposure`, `simulate_depeg_impact`, `verify_alert` and the
`get_methodology` class fallback to api-rs. While `PEGANA_API` pointed at the public
`https://api.pegana.xyz`, Caddy overwrote `X-Forwarded-For` with the MCP container's
egress IP, so every MCP caller shared ONE 60/min api-rs bucket: one busy agent got
everybody HTTP 429.

Branch `fix/r1-mcp` changes two things:

- `docker-compose.yml`: `PEGANA_API: ${MCP_PEGANA_API:-http://api:8080}` (internal,
  docker network). Public links in tool output use `PEGANA_PUBLIC_API`
  (default `https://api.pegana.xyz`).
- `mcp-ts/src/shared/upstream.ts`: every upstream GET forwards the MCP caller's IP
  (first `X-Forwarded-For` entry Caddy set on the MCP request) as `X-Forwarded-For`.
  api-rs (`crates/api-rs/src/rate_limit.rs`) keys its limiter on that header.

Nothing changes in production until the branch is merged and deployed.

Note: for an asset with a cascade, `get_loop_exposure` reads the oldest HF band timestamp
from the `cascade_updated_at` field of the loop-exposure response, so it makes one upstream
GET. Only against an API that predates `cascade_updated_at` does it fall back to a second GET
(`simulate-depeg?shock_bps=100`), which halves the per-caller budget (up to 30 calls per minute
before api-rs answers 429).

## Pre-deploy (read-only)

1. On the server, confirm the prod `.env` does NOT override the new default:

   ```bash
   ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && grep -nE "^(MCP_PEGANA_API|PEGANA_API|PEGANA_PUBLIC_API)=" .env || echo "no override"'
   ```

   - `no override`, or `MCP_PEGANA_API=http://api:8080`: proceed.
   - `MCP_PEGANA_API=https://api.pegana.xyz` (or any public URL): remove that line
     (or set it to `http://api:8080`) before deploying, otherwise the fix is inert.
   - `PEGANA_PUBLIC_API`, if set, must be the public URL `https://api.pegana.xyz`.

2. Confirm the compose file on the server after the pull resolves the value:

   ```bash
   ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && docker compose config mcp-ts | grep -E "PEGANA_API|PEGANA_PUBLIC_API"'
   ```

   Expect `PEGANA_API: http://api:8080` and `PEGANA_PUBLIC_API: https://api.pegana.xyz`.

## Deploy

Use the sanctioned pusher only (never `git push origin main` by hand). `mcp-ts` is
in the default `SERVICES` list of `scripts/deploy.sh`, so a full deploy rebuilds and
force-recreates it:

```bash
./scripts/deploy.sh
```

To roll only the MCP server (api-rs already running the current main):

```bash
./scripts/deploy.sh --services 'mcp-ts'
```

## Post-deploy checks

1. mcp-ts reaches api-rs on the docker network (expect `200`):

   ```bash
   ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && docker compose exec mcp-ts bun -e "fetch(process.env.PEGANA_API + \"/healthz\").then(r=>console.log(r.status))"'
   ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && docker compose exec mcp-ts bun -e "console.log(process.env.PEGANA_API)"'
   ```

   Expect `200` and `http://api:8080`.

2. End-to-end tool calls over the public MCP endpoint return HTTP 200 with no
   `isError`:

   ```bash
   curl -sS -o /tmp/mcp-loop.json -w '%{http_code}\n' -X POST https://mcp.pegana.xyz/ \
     -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_loop_exposure","arguments":{"symbol":"jitoSOL"}}}'
   grep -c '"isError":true' /tmp/mcp-loop.json   # expect 0
   grep -o '"cascade_stale":[a-z]*' /tmp/mcp-loop.json   # present when jitoSOL has a cascade

   curl -sS -o /tmp/mcp-verify.json -w '%{http_code}\n' -X POST https://mcp.pegana.xyz/ \
     -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"verify_alert","arguments":{"alert_id":"<a recent id from https://api.pegana.xyz/v1/audit>"}}}'
   grep -c '"isError":true' /tmp/mcp-verify.json   # expect 0
   ```

3. Rate limiting is per caller. From inside the mcp-ts container, exhaust the budget
   for one documentation-range IP, then confirm a second IP is unaffected. Both IPs
   are RFC 5737 test addresses, so no real user's bucket is touched. Read-only GETs.

   ```bash
   ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && docker compose exec -T mcp-ts bun -e "
     const u = process.env.PEGANA_API + \"/v1/assets\";
     const get = (ip) => fetch(u, { headers: { \"x-forwarded-for\": ip } });
     let last = 0;
     for (let i = 0; i < 65; i++) last = (await get(\"203.0.113.10\")).status;
     const other = await get(\"203.0.113.20\");
     console.log(\"ip A after 65:\", last, \"ip B:\", other.status, \"B RateLimit-Remaining:\", other.headers.get(\"ratelimit-remaining\"));
   "'
   ```

   Expect `ip A after 65: 429`, `ip B: 200`, and a B remaining budget near 59.
   If B also gets 429, the limiter is still keyed on one shared address: roll back.

4. Watch the logs for upstream errors for a few minutes:

   ```bash
   ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && docker compose logs --since 10m mcp-ts | grep -iE "error|429|ECONNREFUSED" | tail -20'
   ```

## Rollback

Point mcp-ts back at the public API (restores the old shared-bucket behaviour, which
was working, only unfair under load). On the server:

```bash
ssh "$PEGANA_DEPLOY_SERVER" 'cd ~/pegana && echo "MCP_PEGANA_API=https://api.pegana.xyz" >> .env'
./scripts/deploy.sh --config-only --services 'mcp-ts'
```

Then repeat post-deploy check 2. Remove the `.env` line again once the cause is
fixed.
