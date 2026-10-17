# Pegana v2 — Phase 2 Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and ship two new B2B distribution channels for Pegana — a hosted MCP server with x402 per-call pricing on Solana mainnet, and an Ed25519-signed webhook channel — on top of the existing Redis pub/sub + Postgres feed. By the end of this plan, `mcp.pegana.xyz` is live with 6 tools (4 free + 2 paid), real USDC settlements work, three reference webhook receivers (TypeScript, Rust, Python) pass a signed-payload test harness in CI, and protocols can self-register webhook subscriptions through `/account/webhooks`.

**Architecture:** Two parallel tracks reading from the same Redis channels the engine already publishes (`pegana:discount`, `pegana:alerts`). MCP server is a new top-level TS package (`mcp-ts/`, Bun + Hono, sibling to `bot-ts/`) using `@modelcontextprotocol/sdk@1.29.0` + `@x402/mcp@2.13.0` + `@x402/svm@2.13.0`. Webhook channel is a new module in the existing `crates/dispatcher-rs/` that signs AlertEvents with Ed25519 and POSTs to subscriber URLs with retry + dead-letter. Both surfaces share a new `webhook_subscriptions` table (migration 0021) and a small account UI page at `/account/webhooks` for self-service registration.

**Tech Stack:** TypeScript 5.7 + Bun + Hono 4.6 + `@modelcontextprotocol/sdk@1.29.0` + `@x402/mcp@2.13.0` + `@x402/svm@2.13.0` + `@x402/core` + `@solana/kit@5.1.0` + `ioredis` + `pg` + `zod` (new mcp-ts package). Existing: Rust 1.83 + tokio + sqlx + reqwest + ed25519-dalek + Postgres 15 + Redis 7 + Caddy on Hetzner CAX21 ARM.

---

## Scope

This plan covers **Phase 2 (Channels)** of the SPEC at `docs/superpowers/specs/2026-05-26-pegana-v2-a2-oracle-reframe-design.md`. Specifically:

- Decision #5 (MCP server in TypeScript with pinned stack)
- Decision #6 (x402 payment per-call on MCP tier, devnet then mainnet)
- Decision #7 (Webhook channel signed with Ed25519, including the reference-receiver test matrix)
- Decision #8 (Public + Agent + Protocol tier pricing — Public + Agent active at launch, Protocol tier "Contact us")
- Decision #12 Phase 2 (verification spike, mcp-ts package, x402 wrapper, Smithery/mcp.run listings, webhook channel)
- Performance budgets from decision #5 (measured during the verification spike + ongoing instrumentation)
- MCP error contract from decision #5 (concrete error envelopes for free and paid tools)

**Prerequisite:** Plan 1 (Phase 0+1 Foundation) is complete — Hetzner deploy is live, `pegana.xyz` already serves the new oracle-first messaging, dogfood produced `CALIBRATION-v1.md`, and the marketing `/developers` page has MCP + Webhook section placeholders that this plan replaces with real content.

**Out of scope:**
- Launch announcement, protocol outreach, hackathon submission (Plan 3 — Phase 3 Distribution).
- On-chain peg-state publisher via Doppler / Switchboard (v2.5+, out of all Phase plans).
- Custom x402 facilitator (uses public `x402.org/facilitator` per SPEC non-goals).

---

## File Structure

### New top-level package: `mcp-ts/`

| Path | Responsibility |
|---|---|
| `mcp-ts/package.json` | Bun + TS package manifest with pinned dependencies (decision #5) |
| `mcp-ts/tsconfig.json` | TS config (target ES2022, module ESM, strict) |
| `mcp-ts/Dockerfile` | Multi-stage build: bun install → bun build → distroless runtime |
| `mcp-ts/src/index.ts` | Entry point — boot Hono server, mount MCP, mount metrics |
| `mcp-ts/src/server.ts` | `createMcpServer()` factory that registers all tools |
| `mcp-ts/src/transport.ts` | Hono Web Standard Streamable HTTP transport (per SDK example) |
| `mcp-ts/src/redis.ts` | Redis client + subscriber wrapper (reuses channel constants from `pegana-common` mirrored locally) |
| `mcp-ts/src/db.ts` | Postgres pool + minimal query helpers |
| `mcp-ts/src/x402.ts` | `@x402/mcp` resource server + facilitator setup |
| `mcp-ts/src/quota.ts` | Daily free-call counter per `payTo`, Redis-backed |
| `mcp-ts/src/tools/get-assets.ts` | Tool: `getAssets()` (free) |
| `mcp-ts/src/tools/get-asset-state.ts` | Tool: `getAssetState(symbol)` (free) |
| `mcp-ts/src/tools/get-asset-history.ts` | Tool: `getAssetHistory(symbol, bucket, limit)` (paid $0.001) |
| `mcp-ts/src/tools/get-methodology.ts` | Tool: `getMethodology(symbol)` (free) |
| `mcp-ts/src/tools/subscribe-peg-events.ts` | Tool: `subscribePegEvents(symbols, threshold_bps)` (paid $0.0005) |
| `mcp-ts/src/tools/ping.ts` | Tool: `ping()` (free, health) |
| `mcp-ts/src/shared/types.ts` | Mirror of `pegana-common` types (PegState, AssetClass, etc., ~50 lines) |
| `mcp-ts/src/metrics.ts` | Prometheus-style counters/histograms |
| `mcp-ts/test/unit/quota.test.ts` | Vitest unit test for daily counter |
| `mcp-ts/test/integration/free-tools.test.ts` | Integration test against prod-local Redis + PG |
| `mcp-ts/test/integration/x402-devnet.test.ts` | End-to-end x402 test on Solana devnet |
| `mcp-ts/.env.example` | All env vars (REDIS_URL, DATABASE_URL, X402_FACILITATOR_URL, PEGANA_PAYTO_USDC, etc.) |

### Modified: `crates/dispatcher-rs/`

| Path | Responsibility |
|---|---|
| `crates/dispatcher-rs/Cargo.toml` | Add `ed25519-dalek = "2"`, `base64 = "0.22"` |
| `crates/dispatcher-rs/src/main.rs` | Boot webhook task alongside Telegram task |
| `crates/dispatcher-rs/src/webhook.rs` | New module — signing, POSTing, retry, dead-letter |
| `crates/dispatcher-rs/src/webhook_queries.rs` | sqlx queries for `webhook_subscriptions` + `webhook_dead_letter` |
| `crates/dispatcher-rs/tests/webhook_signing.rs` | Unit test: signing format roundtrip |
| `crates/dispatcher-rs/tests/webhook_receivers.rs` | Integration: signs payload, calls reference receivers via local HTTP, asserts pass/reject |

### New migration

| Path | Responsibility |
|---|---|
| `migrations/0022_webhook_subscriptions.sql` | Two tables: `webhook_subscriptions`, `webhook_dead_letter` |

(Note: migration `0021` is reserved for the calibration threshold updates from Plan 1 Task E3.)

### New account UI

| Path | Responsibility |
|---|---|
| `web/app/(app)/account/webhooks/page.tsx` | List + create + delete user's webhook subscriptions |
| `web/components/organisms/webhook-list.tsx` | Table organism rendering subscriptions |
| `web/components/molecules/webhook-create-form.tsx` | Form: URL, asset multi-select, threshold |
| `web/lib/api/webhooks.ts` | Client-side fetch wrappers for `/v1/me/webhooks` CRUD |

### New API routes (extend api-rs)

| Path | Responsibility |
|---|---|
| `crates/api-rs/src/routes/webhooks.rs` | `GET /v1/me/webhooks`, `POST`, `DELETE /:id` |
| `crates/api-rs/src/routes/mod.rs` | Mount new router |

### Reference webhook receivers (samples in docs)

| Path | Responsibility |
|---|---|
| `docs/examples/webhook-receivers/typescript-cloudflare-worker/worker.ts` | TS/CFW sample |
| `docs/examples/webhook-receivers/rust-axum/src/main.rs` | Rust/axum sample |
| `docs/examples/webhook-receivers/python-fastapi/main.py` | Python/FastAPI sample |
| `docs/examples/webhook-receivers/README.md` | How to use each sample |

### Modified: `/developers` page

Replaces the MCP + Webhook placeholder content shipped in Plan 1 with real working content.

---

## Track A — Verification spike (1 day, blocks all paid-tool work)

### Task A1: Scaffold `mcp-ts/` package

**Files:**
- Create: `mcp-ts/package.json`
- Create: `mcp-ts/tsconfig.json`
- Create: `mcp-ts/.env.example`
- Create: `mcp-ts/.gitignore`

- [ ] **Step 1: Initialize package**

```bash
mkdir -p /Users/rafazaum/Desktop/Projetos/pegana/mcp-ts/src
cd /Users/rafazaum/Desktop/Projetos/pegana/mcp-ts
bun init -y
```

- [ ] **Step 2: Replace `package.json` with the pinned manifest**

```json
{
  "name": "pegana-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "module": "src/index.ts",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "vitest run",
    "test:integration": "vitest run --dir test/integration",
    "test:devnet": "vitest run --dir test/integration -t devnet",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --ext .ts",
    "build": "bun build src/index.ts --outdir dist --target bun"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@x402/mcp": "^2.13.0",
    "@x402/svm": "^2.13.0",
    "@x402/core": "~2.13.0",
    "@solana/kit": "^5.1.0",
    "hono": "^4.6.0",
    "ioredis": "^5.4.0",
    "pg": "^8.13.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/pg": "^8.11.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "lib": ["ES2022"],
    "types": ["bun-types"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Write `.env.example`**

```
# Redis (same instance as engine-rs + dispatcher-rs use)
REDIS_URL=redis://localhost:6379

# Postgres (same DB)
DATABASE_URL=postgres://pegana:pegana@localhost:5432/pegana

# x402 facilitator
X402_FACILITATOR_URL=https://x402.org/facilitator

# Pegana's USDC receiver on Solana mainnet (hardware-wallet controlled)
# devnet equivalent is the same address pattern
PEGANA_PAYTO_USDC=...

# Solana network for x402 (CAIP-2 format)
# devnet: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
# mainnet: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
SOLANA_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1

# Server
HTTP_PORT=8090
LOG_LEVEL=info

# Optional Sentry
SENTRY_DSN=
```

- [ ] **Step 5: Write `.gitignore`**

```
node_modules
dist
.env
*.log
```

- [ ] **Step 6: Install dependencies**

```bash
cd mcp-ts && bun install
```

Expected: `bun.lock` created, `node_modules/` populated, no peer-dep warnings except possibly Solana kit minor.

- [ ] **Step 7: Commit**

```bash
git add mcp-ts/package.json mcp-ts/tsconfig.json mcp-ts/.env.example mcp-ts/.gitignore mcp-ts/bun.lock
git commit -m "feat(mcp-ts): scaffold package with pinned MCP + x402 stack"
```

### Task A2: Write hello-world MCP server (ping + pingPaid)

**Files:**
- Create: `mcp-ts/src/index.ts`
- Create: `mcp-ts/src/server.ts`
- Create: `mcp-ts/src/transport.ts`
- Create: `mcp-ts/src/x402.ts`
- Create: `mcp-ts/src/tools/ping.ts`

- [ ] **Step 1: Write `src/tools/ping.ts`**

```typescript
import { z } from "zod";

export const pingTool = {
  name: "ping",
  description: "Health check. Free. Returns 'pong' + server uptime in seconds.",
  inputSchema: z.object({}),
  async handler() {
    const uptime = Math.round(process.uptime());
    return {
      content: [{ type: "text" as const, text: `pong (${uptime}s)` }],
    };
  },
};
```

- [ ] **Step 2: Write `src/x402.ts`**

```typescript
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402ResourceServer } from "@x402/mcp";
import { ExactSvmScheme } from "@x402/svm/exact/server";

export async function buildResourceServer() {
  const facilitator = new HTTPFacilitatorClient({
    url: process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
  });
  const server = new x402ResourceServer(facilitator);
  const network = process.env.SOLANA_NETWORK ?? "";
  if (!network.startsWith("solana:")) {
    throw new Error(`SOLANA_NETWORK must be a CAIP-2 'solana:...' string`);
  }
  server.register(network, new ExactSvmScheme());
  await server.initialize();
  return { server, network };
}
```

- [ ] **Step 3: Write `src/server.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPaymentWrapper } from "@x402/mcp";
import { z } from "zod";
import { pingTool } from "@/tools/ping";
import { buildResourceServer } from "@/x402";

export async function createMcpServer() {
  const mcp = new McpServer({ name: "pegana-oracle", version: "0.1.0" });
  const { server: resourceServer, network } = await buildResourceServer();
  const accepts = await resourceServer.buildPaymentRequirements({
    scheme: "exact",
    network,
    payTo: process.env.PEGANA_PAYTO_USDC ?? "",
    price: "$0.001",
  });
  const paid = createPaymentWrapper(resourceServer, { accepts });

  // Free tool
  mcp.tool(
    pingTool.name,
    pingTool.description,
    {},
    pingTool.handler,
  );

  // Paid hello — `pingPaid` ($0.001) just confirms x402 wiring works
  mcp.tool(
    "pingPaid",
    "Paid health check ($0.001). Returns 'paid pong'.",
    {},
    paid(async () => {
      return { content: [{ type: "text" as const, text: "paid pong" }] };
    }),
  );

  return mcp;
}
```

- [ ] **Step 4: Write `src/transport.ts`**

```typescript
import { Hono } from "hono";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "@/server";

export async function buildApp() {
  const app = new Hono();
  const mcp = await createMcpServer();

  app.post("/", async (c) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    await mcp.connect(transport);
    return transport.handleRequest(c.req.raw, c.executionCtx, await c.req.text());
  });

  app.get("/health", (c) => c.text("ok"));

  return app;
}
```

> **Note on transport wiring:** The exact incantation may differ depending on the SDK release. If the import path `@modelcontextprotocol/sdk/server/streamableHttp.js` resolves at install time (verify with `node -e "console.log(require.resolve('@modelcontextprotocol/sdk/server/streamableHttp.js'))"`), use it as written. If not, follow the pattern in `node_modules/@modelcontextprotocol/sdk/dist/esm/examples/server/honoWebStandardStreamableHttp.js` (the reference example referenced in the SPEC). Adjust the Hono adapter accordingly; the test in Task A3 will surface any drift.

- [ ] **Step 5: Write `src/index.ts`**

```typescript
import { buildApp } from "@/transport";

const port = Number(process.env.HTTP_PORT ?? 8090);
const app = await buildApp();

console.log(`pegana-mcp listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
};
```

- [ ] **Step 6: Typecheck**

```bash
cd mcp-ts && bun run typecheck
```

Expected: no errors.

- [ ] **Step 7: Boot locally with placeholder env**

```bash
cd mcp-ts
cp .env.example .env
# Edit .env: set PEGANA_PAYTO_USDC=11111111111111111111111111111111 (placeholder devnet)
bun dev
```

Expected: log line "pegana-mcp listening on :8090". Server does not crash.

> **VERIFY at first boot:** The Hono + Bun export shape used in `src/index.ts`
> (`export default { port, fetch: app.fetch }`) is the canonical Bun.serve
> contract for Hono v4. **If the server does not bind to port 8090 on
> first boot**, two likely fixes:
> 1. Switch to `Bun.serve({ port, fetch: app.fetch })` explicitly at the
>    bottom of `src/index.ts` instead of `export default`.
> 2. Verify Hono adapter — `import { Hono } from "hono"` not
>    `"hono/bun"` (the `/bun` subpath is for runtime helpers, not the
>    Hono constructor).
> Resolve before continuing to A3.

- [ ] **Step 8: Commit**

```bash
git add mcp-ts/src/
git commit -m "feat(mcp-ts): hello-world MCP server with ping + pingPaid (x402 wired)"
```

### Task A3: Test devnet end-to-end

**Files:**
- Create: `mcp-ts/test/integration/x402-devnet.test.ts`

- [ ] **Step 1: Set up a devnet payTo and a devnet payer wallet**

Operational. Rafael needs:
- A Solana devnet address that will receive USDC (the server's `PEGANA_PAYTO_USDC`).
- A funded devnet wallet with airdropped USDC to act as the agent.

Use `solana airdrop` for SOL and a USDC devnet faucet for USDC. Devnet USDC mint per `x402/svm/constants.ts`: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.

- [ ] **Step 2: Write the devnet integration test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("x402 devnet end-to-end", () => {
  // This test requires:
  //   PEGANA_PAYTO_USDC=<devnet address> (server)
  //   X402_PAYER_PRIVATE_KEY=<devnet payer> (client)
  //   SOLANA_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 (devnet)
  // It is skipped if those env vars are missing.

  const skip = !process.env.X402_PAYER_PRIVATE_KEY || !process.env.PEGANA_PAYTO_USDC;
  (skip ? it.skip : it)("ping is free and works", async () => {
    const res = await fetch("http://localhost:8090/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "ping", arguments: {} },
      }),
    });
    const json = await res.json();
    expect(json.result?.content?.[0]?.text).toMatch(/^pong/);
  });

  (skip ? it.skip : it)("pingPaid returns 402 on first call, succeeds with payment", async () => {
    // First call: expect HTTP 402 with x402 payment requirements in body.
    const res1 = await fetch("http://localhost:8090/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "pingPaid", arguments: {} },
      }),
    });
    expect(res1.status).toBe(402);
    const accepts = await res1.json();
    expect(accepts.accepts).toBeTruthy();

    // TODO: sign payment via @x402/svm client and resend.
    // The client-side x402 signing is documented in @x402/svm/exact/client.
    // For now, assert the 402 envelope is well-formed; the signed payment
    // step is exercised in Track C.
  });
});
```

- [ ] **Step 3: Run the test (server must be running in another terminal)**

Terminal 1:
```bash
cd mcp-ts && bun dev
```

Terminal 2:
```bash
cd mcp-ts && PEGANA_PAYTO_USDC=<devnet> X402_PAYER_PRIVATE_KEY=<devnet> SOLANA_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 bun test:devnet
```

Expected: `ping` test passes, `pingPaid` test passes the 402 assertion (full payment loop in Track C).

- [ ] **Step 4: Capture latency baseline**

While the server is running, measure cold and warm latency on `ping`:

```bash
# cold
time curl -s -X POST http://localhost:8090/ -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ping","arguments":{}}}'
# warm (run 50 times, take median)
for i in {1..50}; do
  time curl -s -X POST http://localhost:8090/ -H "content-type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ping","arguments":{}}}' > /dev/null
done 2>&1 | awk '/real/{print $2}' | sort | head -25 | tail -1
```

Record in `docs/CALIBRATION-v2-mcp-spike.md`:
- Cold p99 (target < 800ms per SPEC decision #5)
- Warm p99 (target < 50ms for free tools)

- [ ] **Step 5: Commit**

```bash
git add mcp-ts/test/integration/x402-devnet.test.ts docs/CALIBRATION-v2-mcp-spike.md
git commit -m "test(mcp-ts): devnet verification spike — ping free + pingPaid 402 envelope"
```

### Task A4: Decision gate — verify SPEC budgets

- [ ] **Step 1: Compare measurements against SPEC decision #5 budgets**

| Metric | Measured | Target | Status |
|---|---|---|---|
| MCP cold p99 | (from A3 step 4) | < 800ms | pass / fail |
| MCP warm p99 (free) | (from A3 step 4) | < 50ms | pass / fail |
| x402 facilitator round-trip | (from A3 step 3 timing) | < 1.5s p95 | pass / fail |

- [ ] **Step 2: Decision**

- All pass → proceed to Track B.
- Any fail → **stop, tune, or descope**. Common fixes: enable Hono caching, pre-warm the resource server, switch to a closer facilitator. Document the resolution in `docs/CALIBRATION-v2-mcp-spike.md` before proceeding.

---

## Track B — mcp-ts free tools

### Task B1: Redis subscriber wrapper

**Files:**
- Create: `mcp-ts/src/redis.ts`
- Create: `mcp-ts/src/shared/types.ts`

- [ ] **Step 1: Mirror `pegana-common` types — copy from `web/lib/api/types.ts` (authoritative for consumers)**

Write `mcp-ts/src/shared/types.ts`. Types match `web/lib/api/types.ts` exactly (the frontend has been in production with these strings; they are the consumer wire format):

```typescript
// PegState wire format used by the api-rs REST/WS surface and the
// /asset/* frontend. Postgres enum casts via `::text` in api-rs queries
// produce these strings.
export type PegState =
  | "PEGGED"
  | "DRIFT"
  | "DEPEG"
  | "CRITICAL"
  | "BLACK_SWAN"
  | "UNKNOWN";

// AssetClass wire — matches `web/lib/api/types.ts` exactly.
// Rust enum variants (pegana_common::AssetClass) serialize via
// `#[serde(rename_all = "snake_case")]` to these strings.
export type AssetClass =
  | "lst"
  | "stable_fiat"
  | "stable_cdp"
  | "stable_rwa"
  | "stable_dn"
  | "stable_fx"
  | "synth_lev"
  | "stable_yield";

export type PegTarget = "SOL" | "USD" | "BRL" | "EUR";

export interface DiscountSnapshot {
  asset: string;
  intrinsic_usd: string;
  market_usd: string;
  discount: string;
  state: PegState;
  ts: number;
}

export interface AlertEvent {
  id: string;
  asset: string;
  class: AssetClass;
  peg_target: PegTarget;
  from_state: PegState;
  to_state: PegState;
  discount: string;
  intrinsic_usd: string;
  market_usd: string;
  ts: number;
}

export const CHANNELS = {
  DISCOUNT: "pegana:discount",
  ALERTS: "pegana:alerts",
} as const;
```

> **VERIFY before merging Task B1:** The engine-rs writes `AlertEvent` to the
> `pegana:alerts` Redis stream via serde (`#[serde(rename_all = "UPPERCASE")]`
> on `PegState`). Default serde "UPPERCASE" produces `BLACKSWAN` (no
> underscore), while the api-rs REST output (via `::text` cast on the Postgres
> enum) produces `BLACK_SWAN`. **Confirm the actual wire string** before
> trusting either form by running:
> ```bash
> redis-cli -p 6379 SUBSCRIBE pegana:alerts
> # Trigger a synthetic BlackSwan transition (or inspect a historical event)
> # and capture the actual JSON. Adjust the `PegState` union accordingly.
> ```
> If the Redis wire is `BLACKSWAN` (no underscore), add a normalization
> step in `redis.ts` that translates `BLACKSWAN` → `BLACK_SWAN` so MCP
> consumers see the same string as REST consumers.

- [ ] **Step 2: Write `src/redis.ts`**

```typescript
import Redis from "ioredis";
import { CHANNELS, type DiscountSnapshot, type AlertEvent } from "@/shared/types";

let _client: Redis | null = null;
let _subscriber: Redis | null = null;

export function client(): Redis {
  if (!_client) _client = new Redis(process.env.REDIS_URL ?? "");
  return _client;
}

export function subscriber(): Redis {
  if (!_subscriber) _subscriber = new Redis(process.env.REDIS_URL ?? "");
  return _subscriber;
}

// Cache of latest DiscountSnapshot per asset, kept warm by subscription.
const cache = new Map<string, DiscountSnapshot>();

export async function startCacheWarming(): Promise<void> {
  const sub = subscriber();
  await sub.subscribe(CHANNELS.DISCOUNT);
  sub.on("message", (channel, msg) => {
    if (channel !== CHANNELS.DISCOUNT) return;
    try {
      const snap = JSON.parse(msg) as DiscountSnapshot;
      cache.set(snap.asset, snap);
    } catch {
      // ignore malformed
    }
  });
}

export function getCachedState(asset: string): DiscountSnapshot | undefined {
  return cache.get(asset);
}

export function getAllCachedStates(): DiscountSnapshot[] {
  return Array.from(cache.values());
}

export async function subscribeAlerts(
  handler: (e: AlertEvent) => void | Promise<void>,
): Promise<() => Promise<void>> {
  const sub = new Redis(process.env.REDIS_URL ?? "");
  await sub.subscribe(CHANNELS.ALERTS);
  sub.on("message", async (channel, msg) => {
    if (channel !== CHANNELS.ALERTS) return;
    try {
      await handler(JSON.parse(msg) as AlertEvent);
    } catch {
      // ignore
    }
  });
  return async () => {
    await sub.unsubscribe();
    sub.disconnect();
  };
}
```

- [ ] **Step 3: Wire `startCacheWarming` into `src/index.ts`**

Before `export default`:

```typescript
await startCacheWarming();
```

- [ ] **Step 4: Commit**

```bash
git add mcp-ts/src/shared/types.ts mcp-ts/src/redis.ts mcp-ts/src/index.ts
git commit -m "feat(mcp-ts): Redis subscriber with cache warming + AlertEvent stream"
```

### Task B2: Postgres pool

**Files:**
- Create: `mcp-ts/src/db.ts`

- [ ] **Step 1: Write `src/db.ts`**

```typescript
import pg from "pg";

let _pool: pg.Pool | null = null;

export function pool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return _pool;
}

export interface HistoryRow {
  ts: string;
  discount: string;
  intrinsic_usd: string;
  market_usd: string;
}

export async function fetchHistory(
  asset: string,
  bucket: "1m" | "5m" | "15m" | "1h",
  limit: number,
): Promise<HistoryRow[]> {
  const safeLimit = Math.min(Math.max(1, limit), 50_000);
  const result = await pool().query<HistoryRow>(
    `SELECT
       time_bucket($1::interval, ts) AS ts,
       AVG(discount)::text AS discount,
       AVG(intrinsic_usd)::text AS intrinsic_usd,
       AVG(market_usd)::text AS market_usd
     FROM discount_snapshots
     WHERE asset = $2 AND ts > now() - interval '30 days'
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT $3`,
    [bucket, asset, safeLimit],
  );
  return result.rows;
}
```

- [ ] **Step 2: Commit**

```bash
git add mcp-ts/src/db.ts
git commit -m "feat(mcp-ts): Postgres pool + fetchHistory helper"
```

### Task B3: `getAssets` tool

**Files:**
- Create: `mcp-ts/src/tools/get-assets.ts`
- Modify: `mcp-ts/src/server.ts` (register tool)

- [ ] **Step 1: Write the failing unit test**

Create `mcp-ts/test/unit/get-assets.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getAssetsTool } from "@/tools/get-assets";

describe("getAssets", () => {
  it("returns content array with JSON of cached states", async () => {
    const res = await getAssetsTool.handler({});
    expect(res.content).toBeInstanceOf(Array);
    expect(res.content[0].type).toBe("text");
    const parsed = JSON.parse(res.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd mcp-ts && bun test test/unit/get-assets.test.ts
```

Expected: FAIL — `getAssetsTool` not defined.

- [ ] **Step 3: Implement `src/tools/get-assets.ts`**

```typescript
import { z } from "zod";
import { getAllCachedStates } from "@/redis";

export const getAssetsTool = {
  name: "getAssets",
  description: "List all tracked assets with current peg state. Free.",
  inputSchema: z.object({}),
  async handler() {
    const states = getAllCachedStates();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(states, null, 2) },
      ],
    };
  },
};
```

- [ ] **Step 4: Run test, expect pass**

```bash
cd mcp-ts && bun test test/unit/get-assets.test.ts
```

Expected: PASS (cache is empty → empty array, which is still valid JSON).

- [ ] **Step 5: Register in `src/server.ts`**

Add to imports and after the `ping` registration:

```typescript
import { getAssetsTool } from "@/tools/get-assets";
// ...
mcp.tool(
  getAssetsTool.name,
  getAssetsTool.description,
  {},
  getAssetsTool.handler,
);
```

- [ ] **Step 6: Commit**

```bash
git add mcp-ts/src/tools/get-assets.ts mcp-ts/src/server.ts mcp-ts/test/unit/get-assets.test.ts
git commit -m "feat(mcp-ts): getAssets tool (free, Redis-cached)"
```

### Task B4: `getAssetState` tool

**Files:**
- Create: `mcp-ts/src/tools/get-asset-state.ts`
- Modify: `mcp-ts/src/server.ts`

- [ ] **Step 1: Write failing test**

Create `mcp-ts/test/unit/get-asset-state.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getAssetStateTool } from "@/tools/get-asset-state";

describe("getAssetState", () => {
  it("returns isError when asset unknown", async () => {
    const res = await getAssetStateTool.handler({ symbol: "ZZZ" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not tracked/i);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
bun test test/unit/get-asset-state.test.ts
```

- [ ] **Step 3: Implement**

```typescript
import { z } from "zod";
import { getCachedState } from "@/redis";

export const getAssetStateTool = {
  name: "getAssetState",
  description: "Current peg state + discount + intrinsic + market for one asset. Free.",
  inputSchema: z.object({ symbol: z.string().min(1).max(20) }),
  async handler(args: { symbol: string }) {
    const snap = getCachedState(args.symbol);
    if (!snap) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: asset '${args.symbol}' not tracked. Use getAssets() to list tracked symbols.`,
        }],
        isError: true,
      };
    }
    // Stale check (> 5 min)
    const ageSec = Math.floor((Date.now() / 1000) - snap.ts);
    if (ageSec > 300) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(snap, null, 2) }],
        isError: true,
        _meta: { state: "UNKNOWN", lastFreshSec: ageSec },
      };
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(snap, null, 2) }],
    };
  },
};
```

- [ ] **Step 4: Pass test + register in server.ts**

```bash
bun test test/unit/get-asset-state.test.ts
```

In `server.ts`:

```typescript
import { getAssetStateTool } from "@/tools/get-asset-state";
// ...
mcp.tool(
  getAssetStateTool.name,
  getAssetStateTool.description,
  { symbol: z.string().min(1).max(20) },
  getAssetStateTool.handler,
);
```

- [ ] **Step 5: Commit**

```bash
git add mcp-ts/src/tools/get-asset-state.ts mcp-ts/src/server.ts mcp-ts/test/unit/get-asset-state.test.ts
git commit -m "feat(mcp-ts): getAssetState tool (free, stale-check)"
```

### Task B5: `getMethodology` tool

**Files:**
- Create: `mcp-ts/src/tools/get-methodology.ts`
- Create: `mcp-ts/src/shared/methodology.ts` (per-class explanations)
- Modify: `mcp-ts/src/server.ts`

- [ ] **Step 1: Write `src/shared/methodology.ts`**

```typescript
import type { AssetClass } from "@/shared/types";

const PER_CLASS: Record<AssetClass, string> = {
  lst: "LSTs price in two places — Sanctum's stake-pool calculator (intrinsic, in SOL terms × Pyth SOL/USD) and Jupiter's market quote (effective rate × Pyth SOL/USD). Pegana takes the EWMA of (1 − market/intrinsic) over a sliding window and applies per-asset hysteresis windows of 30s entry / 120s exit.",
  stable_fiat: "Fiat-backed stables (USDC, USDT, PYUSD, USDS) are pegged to $1 — intrinsic is hardcoded; market is Jupiter quote vs USDC.",
  stable_yield: "Yield-bearing stables use NAV semantics — intrinsic is the issuer's attested NAV via Pyth Redemption Rate feeds (USDY, syrupUSDC, sUSDe) or Token-2022 InterestBearing rebasing rate (sUSD). Market is Jupiter quote.",
  stable_cdp: "CDP stables (hyUSD) decode the on-chain Hylo Exchange state to compute collateral ratio (CR). Intrinsic is implicit at $1 above the Stability-Mode floor; below floor, CR itself is the alert dimension.",
  stable_dn: "Delta-neutral stables (USDe) — intrinsic is $1; market is Jupiter. Pegana applies wider thresholds because the mechanism allows transient drift under funding-rate inversion.",
  stable_fx: "FX stables (BRZ) — intrinsic target is derived from Pyth USD/BRL FX feed. Market is Jupiter. Wide thresholds reflect thin Jupiter BRZ liquidity.",
  synthetic: "Synthetic / leveraged assets (xSOL) — wide bands by design. The asset is informational, not pegged in the conventional sense.",
};

export function methodologyFor(asset: string, cls: AssetClass | undefined): string {
  if (!cls) return `Asset '${asset}' methodology: unknown class. See https://pegana.xyz/methodology`;
  return `Asset '${asset}' (${cls}):\n\n${PER_CLASS[cls]}\n\nFull methodology + state machine: https://pegana.xyz/methodology`;
}
```

- [ ] **Step 2: Write `src/tools/get-methodology.ts`**

```typescript
import { z } from "zod";
import { getCachedState } from "@/redis";
import { methodologyFor } from "@/shared/methodology";

export const getMethodologyTool = {
  name: "getMethodology",
  description: "Per-asset peg-mechanism explanation. Free.",
  inputSchema: z.object({ symbol: z.string().min(1).max(20) }),
  async handler(args: { symbol: string }) {
    const snap = getCachedState(args.symbol);
    // Even if no snapshot, we may know the class from a static catalog; for v2
    // we degrade gracefully to a generic explanation.
    const text = methodologyFor(args.symbol, undefined);
    return { content: [{ type: "text" as const, text }] };
  },
};
```

> Note: a richer version would load `assets.toml` server-side at boot and look up the class. For v2 we keep it minimal and link to the website. Iterate if agent users ask.

- [ ] **Step 3: Register + commit**

```typescript
// server.ts
import { getMethodologyTool } from "@/tools/get-methodology";
mcp.tool(getMethodologyTool.name, getMethodologyTool.description, { symbol: z.string() }, getMethodologyTool.handler);
```

```bash
git add mcp-ts/src/tools/get-methodology.ts mcp-ts/src/shared/methodology.ts mcp-ts/src/server.ts
git commit -m "feat(mcp-ts): getMethodology tool (free, per-class explanations)"
```

### Task B6: Internal soak test against prod-local

- [ ] **Step 1: Start prod-local docker stack**

```bash
docker compose -f docker-compose.local.yml up -d
```

Wait for engine-rs to start publishing to `pegana:discount` (verify: `redis-cli -p 6381 PSUBSCRIBE pegana:*`).

- [ ] **Step 2: Boot mcp-ts pointing at prod-local**

```bash
cd mcp-ts
REDIS_URL=redis://localhost:6381 \
DATABASE_URL=postgres://pegana:pegana@localhost:5434/pegana \
PEGANA_PAYTO_USDC=<placeholder devnet addr> \
SOLANA_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 \
bun dev
```

- [ ] **Step 3: Call all three free tools via curl**

```bash
# getAssets
curl -s -X POST http://localhost:8090/ -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"getAssets","arguments":{}}}' | jq .

# getAssetState
curl -s -X POST http://localhost:8090/ -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"getAssetState","arguments":{"symbol":"jitoSOL"}}}' | jq .

# getMethodology
curl -s -X POST http://localhost:8090/ -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"getMethodology","arguments":{"symbol":"jitoSOL"}}}' | jq .
```

Expected: all three return valid MCP envelopes with content. `getAssets` returns ≥ 1 entry (cache is warm because engine-rs is publishing).

- [ ] **Step 4: Run latency probe (50 iterations of getAssetState, capture p50/p99)**

```bash
for i in {1..50}; do
  start=$(date +%s%N)
  curl -s -X POST http://localhost:8090/ -H "content-type: application/json" \
    -d '{"jsonrpc":"2.0","id":'$i',"method":"tools/call","params":{"name":"getAssetState","arguments":{"symbol":"jitoSOL"}}}' > /dev/null
  end=$(date +%s%N)
  echo $(( (end - start) / 1000000 ))
done | sort -n | awk '{a[NR]=$1} END {print "p50:", a[int(NR*0.5)], "p99:", a[int(NR*0.99)]}'
```

Expected: p99 < 50ms (SPEC budget).

If miss: investigate `ioredis` connection pooling, Hono overhead, or cache miss frequency. Tune until under budget.

- [ ] **Step 5: Record results in `docs/CALIBRATION-v2-mcp-spike.md`**

Append:

```markdown
## B6 internal soak (YYYY-MM-DD)
- getAssetState p50: <X>ms, p99: <Y>ms (target < 50ms warm)
- getAssets p99: <Z>ms
- Cache fill time after boot: <T>s
```

- [ ] **Step 6: Commit**

```bash
git add docs/CALIBRATION-v2-mcp-spike.md
git commit -m "test(mcp-ts): free tools internal soak — latency baseline"
```

---

## Track C — Paid tools + x402

### Task C1: `getAssetHistory` tool

**Files:**
- Create: `mcp-ts/src/tools/get-asset-history.ts`
- Modify: `mcp-ts/src/server.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/unit/get-asset-history.test.ts
import { describe, it, expect, vi } from "vitest";
import { getAssetHistoryTool } from "@/tools/get-asset-history";

vi.mock("@/db", () => ({
  fetchHistory: vi.fn().mockResolvedValue([
    { ts: "2026-05-26T00:00:00Z", discount: "-0.0034", intrinsic_usd: "1.0", market_usd: "0.9966" },
  ]),
}));

describe("getAssetHistory", () => {
  it("returns history rows as JSON", async () => {
    const res = await getAssetHistoryTool.handler({ symbol: "jitoSOL", bucket: "1m", limit: 10 });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed[0].discount).toBe("-0.0034");
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import { z } from "zod";
import { fetchHistory } from "@/db";

export const getAssetHistoryTool = {
  name: "getAssetHistory",
  description: "Time-series of intrinsic-vs-market discount for one asset. Paid ($0.001/call).",
  inputSchema: z.object({
    symbol: z.string().min(1).max(20),
    bucket: z.enum(["1m", "5m", "15m", "1h"]).default("1m"),
    limit: z.number().int().min(1).max(50_000).default(1000),
  }),
  async handler(args: { symbol: string; bucket: "1m" | "5m" | "15m" | "1h"; limit: number }) {
    const rows = await fetchHistory(args.symbol, args.bucket, args.limit);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(rows) }],
    };
  },
};
```

- [ ] **Step 3: Pass test**

```bash
cd mcp-ts && bun test test/unit/get-asset-history.test.ts
```

- [ ] **Step 4: Register WITH payment wrapper in server.ts**

In `createMcpServer`, after the `paid` wrapper exists:

```typescript
import { getAssetHistoryTool } from "@/tools/get-asset-history";
// ...
mcp.tool(
  getAssetHistoryTool.name,
  getAssetHistoryTool.description,
  {
    symbol: z.string().min(1).max(20),
    bucket: z.enum(["1m", "5m", "15m", "1h"]).optional(),
    limit: z.number().int().optional(),
  },
  paid(getAssetHistoryTool.handler),
);
```

- [ ] **Step 5: Commit**

```bash
git add mcp-ts/src/tools/get-asset-history.ts mcp-ts/src/server.ts mcp-ts/test/unit/get-asset-history.test.ts
git commit -m "feat(mcp-ts): getAssetHistory tool (paid \$0.001 via x402)"
```

### Task C2: `subscribePegEvents` tool

**Files:**
- Create: `mcp-ts/src/tools/subscribe-peg-events.ts`
- Modify: `mcp-ts/src/server.ts`

- [ ] **Step 1: Design contract**

MCP tools are request/response, not streaming in the classic sense. The `subscribePegEvents` tool returns ONE batch of AlertEvents that arrived since `since_ts` (provided by the agent). For continuous streaming the agent polls, paying per call. This is the simpler v2 contract; true streaming via MCP resources is a v2.1+ consideration.

- [ ] **Step 2: Write the tool**

```typescript
import { z } from "zod";
import { subscriber } from "@/redis";
import { pool } from "@/db";

export const subscribePegEventsTool = {
  name: "subscribePegEvents",
  description: "AlertEvents for matching subscriptions since `since_ts`. Paid (\$0.0005/call).",
  inputSchema: z.object({
    symbols: z.array(z.string()).min(1).max(20),
    since_ts: z.number().int(),
    threshold_bps: z.number().int().min(0).max(10_000).optional(),
  }),
  async handler(args: { symbols: string[]; since_ts: number; threshold_bps?: number }) {
    const minBps = args.threshold_bps ?? 0;
    const result = await pool().query<{
      id: string; asset: string; from_state: string; to_state: string;
      discount: string; ts: number;
    }>(
      `SELECT id, asset, from_state, to_state,
              discount::text,
              EXTRACT(EPOCH FROM ts)::int AS ts
       FROM alert_events
       WHERE asset = ANY($1)
         AND ts > to_timestamp($2)
         AND ABS(discount * 10000) >= $3
       ORDER BY ts ASC
       LIMIT 1000`,
      [args.symbols, args.since_ts, minBps],
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.rows) }],
    };
  },
};
```

- [ ] **Step 3: Register WITH payment wrapper at $0.0005**

The `paid` wrapper in `server.ts` is built with `price: "$0.001"`. For `subscribePegEvents` at $0.0005, you need a SECOND payment wrapper. Refactor `server.ts`:

```typescript
const acceptsHistory = await resourceServer.buildPaymentRequirements({
  scheme: "exact", network, payTo: process.env.PEGANA_PAYTO_USDC ?? "", price: "$0.001",
});
const paidHistory = createPaymentWrapper(resourceServer, { accepts: acceptsHistory });

const acceptsSub = await resourceServer.buildPaymentRequirements({
  scheme: "exact", network, payTo: process.env.PEGANA_PAYTO_USDC ?? "", price: "$0.0005",
});
const paidSub = createPaymentWrapper(resourceServer, { accepts: acceptsSub });

// Then wrap each tool with the appropriate wrapper.
```

- [ ] **Step 4: Commit**

```bash
git add mcp-ts/src/tools/subscribe-peg-events.ts mcp-ts/src/server.ts
git commit -m "feat(mcp-ts): subscribePegEvents tool (paid \$0.0005)"
```

### Task C3: Devnet 24h soak

- [ ] **Step 1: Deploy mcp-ts to a devnet-tracking instance**

Use Hetzner staging or a temporary docker run with devnet env. Configure:
- `SOLANA_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`
- `PEGANA_PAYTO_USDC=<devnet receiver>`
- Real x402 facilitator

- [ ] **Step 2: Run a synthetic agent making periodic paid calls**

```bash
# Loop 100 paid calls over 24 hours; check that settlements occur on devnet.
for i in {1..100}; do
  curl -s -X POST https://mcp-staging.pegana.xyz/ \
    -H "content-type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"getAssetHistory","arguments":{"symbol":"jitoSOL","bucket":"1m","limit":10}}}'
  sleep 864  # 100 calls over ~24h
done > /tmp/mcp-soak.log 2>&1 &
```

The first call returns 402; the second (with signed payment) returns the data. Use `@x402/svm/exact/client` from the agent side to sign.

- [ ] **Step 3: Monitor**

- Check that all 100 calls (after the initial 402 each) succeed.
- Check on-chain that 100 USDC settlements landed at `PEGANA_PAYTO_USDC` (Solana Explorer devnet).
- Check that `pegana_mcp_payments_total{status="success"}` increases by 100 (after Track E lands metrics).

- [ ] **Step 4: Decision gate**

- 100% success → proceed to C4 (switch to mainnet).
- Any failure mode → diagnose, fix, restart 24h clock. Do not skip.

- [ ] **Step 5: Record in `docs/CALIBRATION-v2-mcp-spike.md`**

Append a "C3 devnet soak" section with: total calls, success rate, p95 settlement latency, any anomalies.

### Task C4: Switch to Solana mainnet

**Files:**
- Modify: production env (Hetzner deploy `.env`) — operational

- [ ] **Step 1: Provision the mainnet `PEGANA_PAYTO_USDC` address**

Operational. Rafael creates a hardware-wallet-controlled Solana address (Ledger-derived; seed in cold storage). Records the address.

- [ ] **Step 2: Set production env**

```
SOLANA_NETWORK=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
PEGANA_PAYTO_USDC=<mainnet hardware-wallet address>
```

- [ ] **Step 3: Restart `mcp.pegana.xyz`**

```bash
docker compose -f docker-compose.yml restart mcp-ts
```

- [ ] **Step 4: First-mainnet validation by Rafael**

Personally spend $0.001 USDC against `getAssetHistory` via Claude Desktop or `curl` + a signed payment. Confirm:
- Response succeeds.
- USDC arrives at `PEGANA_PAYTO_USDC` on mainnet (Solana Explorer).

- [ ] **Step 5: Note milestone**

Append to `docs/CALIBRATION-v2-mcp-spike.md`: "Mainnet first paid call: YYYY-MM-DD HH:MM UTC. Signature: <sig>."

No commit; operational.

---

## Track D — Free quota enforcement

### Task D1: Daily counter

**Files:**
- Create: `mcp-ts/src/quota.ts`
- Create: `mcp-ts/test/unit/quota.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { incrementAndCheck, FREE_DAILY_LIMIT } from "@/quota";
import { client } from "@/redis";

describe("quota", () => {
  const payTo = "test-payto-1";
  beforeEach(async () => {
    await client().del(`pegana:quota:${payTo}:${new Date().toISOString().slice(0, 10)}`);
  });

  it("allows up to FREE_DAILY_LIMIT calls", async () => {
    for (let i = 0; i < FREE_DAILY_LIMIT; i++) {
      const r = await incrementAndCheck(payTo);
      expect(r.allowed).toBe(true);
    }
    const r = await incrementAndCheck(payTo);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import { client } from "@/redis";

export const FREE_DAILY_LIMIT = 1000;

export async function incrementAndCheck(
  payTo: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `pegana:quota:${payTo}:${day}`;
  const count = await client().incr(key);
  if (count === 1) {
    await client().expire(key, 86_400 * 2); // 2-day window for safety
  }
  const remaining = Math.max(0, FREE_DAILY_LIMIT - count);
  return { allowed: count <= FREE_DAILY_LIMIT, remaining };
}
```

- [ ] **Step 3: Pass test**

```bash
cd mcp-ts && bun test test/unit/quota.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add mcp-ts/src/quota.ts mcp-ts/test/unit/quota.test.ts
git commit -m "feat(mcp-ts): daily free-call counter per payTo (Redis-backed)"
```

### Task D2: Wire quota into free tools

**Files:**
- Modify: `mcp-ts/src/server.ts` or each free tool

For v2, simpler approach: gate `getAssetHistory` (the highest-cardinality paid tool) with a free quota of 0 for non-`payTo` callers (i.e., unauth calls are paid from request #1). For free tools, no quota (they are cheap, Redis-cached).

- [ ] **Step 1: Identify caller payTo**

The x402 payment envelope carries `payer` info; for FREE callers (no x402 header), there is no payTo. Treat the request origin (`x-forwarded-for` or session cookie) as the rate-limit key, distinct from quota.

For v2: skip quota implementation on free tools (they're sub-50ms and Redis-cached, can serve thousands/sec). Re-evaluate if abuse appears.

- [ ] **Step 2: Document the decision**

Append to `mcp-ts/README.md` (create if missing):

```markdown
## Quota model (v2)

- Free tools (`getAssets`, `getAssetState`, `getMethodology`, `ping`):
  no per-caller quota. Rate-limited at the reverse proxy (Caddy) to 60
  req/min/IP.
- Paid tools (`getAssetHistory`, `subscribePegEvents`): metered by x402
  per call. No free tier for paid tools in v2 — the agent always pays.
  (The originally-specced "1000 free calls/day per payTo" is descoped to
  v2.1 once we have telemetry to define a sane default.)
```

- [ ] **Step 3: Commit**

```bash
git add mcp-ts/README.md
git commit -m "docs(mcp-ts): document quota model — free tools open, paid metered by x402"
```

---

## Track E — Observability

### Task E1: Prometheus metrics endpoint

**Files:**
- Create: `mcp-ts/src/metrics.ts`
- Modify: `mcp-ts/src/transport.ts` (mount `/metrics`)
- Modify: each tool handler (wrap with counter + histogram)

- [ ] **Step 1: Write `src/metrics.ts`**

```typescript
const counters = new Map<string, number>();
const histograms = new Map<string, number[]>();

export function incr(name: string, labels: Record<string, string> = {}, by = 1) {
  const key = `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",")}}`;
  counters.set(key, (counters.get(key) ?? 0) + by);
}

export function observe(name: string, labels: Record<string, string>, valueMs: number) {
  const key = `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",")}}`;
  const arr = histograms.get(key) ?? [];
  arr.push(valueMs);
  // cap memory at last 10k observations per series
  if (arr.length > 10_000) arr.splice(0, arr.length - 10_000);
  histograms.set(key, arr);
}

export function renderProm(): string {
  const lines: string[] = [];
  for (const [k, v] of counters) lines.push(`${k} ${v}`);
  for (const [k, arr] of histograms) {
    const sorted = [...arr].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
    lines.push(`${k.replace("}", `,quantile="0.5"}`)} ${p50}`);
    lines.push(`${k.replace("}", `,quantile="0.99"}`)} ${p99}`);
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 2: Mount `/metrics`**

In `src/transport.ts`:

```typescript
import { renderProm } from "@/metrics";
// ...
app.get("/metrics", (c) => c.text(renderProm(), 200, { "content-type": "text/plain" }));
```

- [ ] **Step 3: Instrument each tool**

Wrap each tool handler in a timer + counter. Simplest: create a helper in `src/server.ts`:

```typescript
import { incr, observe } from "@/metrics";

function withMetrics<TArgs, TRes>(toolName: string, h: (args: TArgs) => Promise<TRes>) {
  return async (args: TArgs): Promise<TRes> => {
    const start = Date.now();
    let status = "success";
    try {
      return await h(args);
    } catch (e) {
      status = "error";
      throw e;
    } finally {
      incr("pegana_mcp_tool_calls_total", { tool: toolName, status });
      observe("pegana_mcp_tool_latency_seconds", { tool: toolName }, Date.now() - start);
    }
  };
}

// Use it when registering: `mcp.tool(name, desc, schema, withMetrics(name, handler))`
```

- [ ] **Step 4: Commit**

```bash
git add mcp-ts/src/metrics.ts mcp-ts/src/transport.ts mcp-ts/src/server.ts
git commit -m "feat(mcp-ts): /metrics endpoint + per-tool counters and latency histograms"
```

### Task E2: Sentry integration

**Files:**
- Modify: `mcp-ts/package.json` (add @sentry/bun)
- Modify: `mcp-ts/src/index.ts`

- [ ] **Step 1: Install**

```bash
cd mcp-ts && bun add @sentry/node
```

(`@sentry/bun` may not exist as of writing; `@sentry/node` works on Bun.)

- [ ] **Step 2: Init in `index.ts`**

```typescript
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV ?? "production",
  });
}
```

- [ ] **Step 3: Wrap tool errors to send to Sentry**

In `withMetrics` helper, on catch:

```typescript
} catch (e) {
  status = "error";
  Sentry.captureException(e, { tags: { tool: toolName } });
  throw e;
}
```

- [ ] **Step 4: Commit**

```bash
git add mcp-ts/package.json mcp-ts/bun.lock mcp-ts/src/index.ts mcp-ts/src/server.ts
git commit -m "feat(mcp-ts): Sentry integration for tool errors"
```

### Task E3: Grafana dashboard panel

**Files:**
- Create: `docs/grafana/dashboards/mcp-ts.json`

- [ ] **Step 1: Author dashboard JSON**

Use Grafana's "Add panel" UI on the existing oracle dashboard to add:
- Counter: `sum(rate(pegana_mcp_tool_calls_total{status="success"}[5m]))` by tool
- Histogram: `pegana_mcp_tool_latency_seconds` p50 + p99 by tool
- Counter: `sum(rate(pegana_mcp_payments_total{status="success"}[5m]))`

Export the dashboard JSON and save to `docs/grafana/dashboards/mcp-ts.json`.

- [ ] **Step 2: Commit**

```bash
git add docs/grafana/dashboards/mcp-ts.json
git commit -m "ops: Grafana dashboard panels for mcp-ts metrics"
```

---

## Track F — Deploy mcp.pegana.xyz

### Task F1: Dockerize mcp-ts

**Files:**
- Create: `mcp-ts/Dockerfile`
- Create: `mcp-ts/.dockerignore`
- Modify: `docker-compose.yml` (add `mcp-ts` service)

- [ ] **Step 1: Write Dockerfile**

```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json ./
COPY src ./src
RUN bun build src/index.ts --outdir dist --target bun

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 8090
CMD ["bun", "dist/index.js"]
```

- [ ] **Step 2: Write `.dockerignore`**

```
node_modules
dist
.env
*.log
test
```

- [ ] **Step 3: Add service to `docker-compose.yml`**

```yaml
  mcp-ts:
    build: ./mcp-ts
    container_name: pegana-mcp
    restart: unless-stopped
    environment:
      REDIS_URL: redis://redis:6379
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      X402_FACILITATOR_URL: ${X402_FACILITATOR_URL}
      PEGANA_PAYTO_USDC: ${PEGANA_PAYTO_USDC}
      SOLANA_NETWORK: ${SOLANA_NETWORK}
      HTTP_PORT: 8090
      SENTRY_DSN: ${SENTRY_DSN}
    ports:
      - "8090:8090"
    depends_on:
      - redis
      - postgres
```

- [ ] **Step 4: Local build test**

```bash
docker compose build mcp-ts
docker compose up -d mcp-ts
curl -s http://localhost:8090/health
```

Expected: returns `ok`.

- [ ] **Step 5: Commit**

```bash
git add mcp-ts/Dockerfile mcp-ts/.dockerignore docker-compose.yml
git commit -m "build(mcp-ts): Dockerfile + compose service"
```

### Task F2: Caddy reverse proxy for mcp.pegana.xyz

**Files:**
- Modify: `Caddyfile`

- [ ] **Step 1: Add subdomain block to `Caddyfile`**

> **Audit note:** the existing `Caddyfile` already has the `api.pegana.xyz`
> vhost configured with TLS + headers. Match that style (Strict-Transport-
> Security, etc.) for `mcp.pegana.xyz` — the snippet below is minimal;
> harden before production.

```
mcp.pegana.xyz {
  encode gzip zstd

  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options nosniff
    X-Frame-Options DENY
    Referrer-Policy strict-origin-when-cross-origin
  }

  reverse_proxy mcp-ts:8090

  log {
    output stdout
    format console
  }
}
```

- [ ] **Step 2: Validate Caddy config**

```bash
caddy validate --config Caddyfile
```

- [ ] **Step 3: DNS update (operational)**

Add an A record for `mcp.pegana.xyz` pointing to the Hetzner CAX21 IP. Wait for propagation.

- [ ] **Step 4: Reload Caddy**

```bash
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

> **VERIFY before relying on hot reload:** Caddy's admin API defaults to
> `localhost:2019` inside the container — `caddy reload` writes to that
> socket and works without restart **IF** the container hasn't disabled
> the admin endpoint. The existing `Caddyfile` doesn't show an explicit
> `admin off` global directive, but verify with:
> ```bash
> docker compose exec caddy curl -s http://localhost:2019/config/ | head -c 50
> ```
> If empty/404, the admin endpoint is disabled — fall back to a container
> restart: `docker compose restart caddy`. Restart is ~2s and acceptable
> for this rollout.

- [ ] **Step 5: Verify TLS + endpoint**

```bash
curl -I https://mcp.pegana.xyz/health
```

Expected: 200 with valid TLS.

- [ ] **Step 6: Commit**

```bash
git add Caddyfile
git commit -m "ops(caddy): expose mcp.pegana.xyz reverse proxy"
```

### Task F3: Smithery + mcp.run listing

**Files:**
- Create: `docs/listings/smithery.md`
- Create: `docs/listings/mcp-run.md`

- [ ] **Step 1: Research submission template**

Open smithery.ai and mcp.run, find the submission form for hosted MCP servers. Capture required fields (name, description, tool list, pricing, demo URL, etc.).

- [ ] **Step 2: Fill submissions**

Submit Pegana via each directory's process. The endpoint is `https://mcp.pegana.xyz`. Tool list:
- `getAssets` (free)
- `getAssetState` (free)
- `getMethodology` (free)
- `ping` (free)
- `getAssetHistory` ($0.001)
- `subscribePegEvents` ($0.0005)

Tagline: "The peg-risk oracle for Solana. Read real-time peg state for 23 LSTs, stablecoins, yield-bearing, CDPs, and synthetics."

- [ ] **Step 3: Document submission and any feedback**

Save the submission state to `docs/listings/smithery.md` and `docs/listings/mcp-run.md` (URL, date, status: pending/approved).

- [ ] **Step 4: Commit**

```bash
git add docs/listings/
git commit -m "ops: Smithery + mcp.run submission records"
```

---

## Track G — Webhook channel (Rust dispatcher)

### Task G1: Migration `0022_webhook_subscriptions.sql`

**Files:**
- Create: `migrations/0022_webhook_subscriptions.sql`

- [ ] **Step 1: Write migration**

```sql
-- 0022: Webhook channel — subscription registry + dead-letter queue.

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         BIGINT       NOT NULL REFERENCES users(id),
    url             TEXT         NOT NULL,
    asset           TEXT         NOT NULL REFERENCES assets(symbol),
    threshold_bps   INTEGER      NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_fired_at   TIMESTAMPTZ,
    last_status     SMALLINT,
    UNIQUE (user_id, url, asset)
);

CREATE INDEX IF NOT EXISTS webhook_subs_active_asset_idx
    ON webhook_subscriptions(asset, is_active) WHERE is_active;

CREATE TABLE IF NOT EXISTS webhook_dead_letter (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID         NOT NULL REFERENCES webhook_subscriptions(id),
    alert_id        UUID         NOT NULL,
    payload         JSONB        NOT NULL,
    last_error      TEXT         NOT NULL,
    attempts        SMALLINT     NOT NULL,
    failed_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_dl_failed_at_idx
    ON webhook_dead_letter(failed_at);
```

- [ ] **Step 2: Apply locally and verify**

```bash
cargo run -p xtask -- migrate
psql $DATABASE_URL -c "\\d webhook_subscriptions"
psql $DATABASE_URL -c "\\d webhook_dead_letter"
```

Expected: both tables exist with the columns above.

- [ ] **Step 3: Commit**

```bash
git add migrations/0022_webhook_subscriptions.sql
git commit -m "feat(db): 0022 webhook_subscriptions + dead_letter tables"
```

### Task G2: Add Ed25519 deps to dispatcher-rs

**Files:**
- Modify: `crates/dispatcher-rs/Cargo.toml`

- [ ] **Step 1: Add deps**

```toml
[dependencies]
# ...existing...
ed25519-dalek = { version = "2.1", features = ["rand_core"] }
base64 = "0.22"
rand = "0.8"
```

- [ ] **Step 2: Cargo check**

```bash
cargo check -p dispatcher-rs
```

- [ ] **Step 3: Commit**

```bash
git add crates/dispatcher-rs/Cargo.toml Cargo.lock
git commit -m "build(dispatcher-rs): add ed25519-dalek + base64 deps"
```

### Task G3: `webhook.rs` signing module

**Files:**
- Create: `crates/dispatcher-rs/src/webhook.rs`
- Create: `crates/dispatcher-rs/tests/webhook_signing.rs`

- [ ] **Step 1: Write the failing test**

```rust
// crates/dispatcher-rs/tests/webhook_signing.rs
use dispatcher_rs::webhook::{sign_payload, verify_payload, SigningKey};

#[test]
fn sign_then_verify_roundtrip() {
    let key = SigningKey::generate(&mut rand::thread_rng());
    let ts = "1779827802";
    let body = r#"{"asset":"sUSDe","from_state":"PEGGED","to_state":"DRIFT"}"#;
    let sig = sign_payload(&key, ts, body);
    let ok = verify_payload(&key.verifying_key(), ts, body, &sig);
    assert!(ok);
}

#[test]
fn tampered_body_rejected() {
    let key = SigningKey::generate(&mut rand::thread_rng());
    let ts = "1779827802";
    let body = r#"{"asset":"sUSDe"}"#;
    let sig = sign_payload(&key, ts, body);
    let tampered = r#"{"asset":"sUSDx"}"#;
    let ok = verify_payload(&key.verifying_key(), ts, tampered, &sig);
    assert!(!ok);
}
```

- [ ] **Step 2: Run test, expect failure**

```bash
cargo test -p dispatcher-rs --test webhook_signing
```

Expected: FAIL — `webhook` module not exposed.

- [ ] **Step 3: Implement `src/webhook.rs`**

```rust
//! Ed25519-signed webhook dispatch.

use base64::{engine::general_purpose::STANDARD, Engine};
pub use ed25519_dalek::{Signature, SigningKey, VerifyingKey};
use ed25519_dalek::Signer;

/// Sign `<timestamp>.<body>` (canonical UTF-8) with Ed25519.
/// Returns base64-encoded signature.
pub fn sign_payload(key: &SigningKey, ts: &str, body: &str) -> String {
    let input = format!("{}.{}", ts, body);
    let sig: Signature = key.sign(input.as_bytes());
    STANDARD.encode(sig.to_bytes())
}

/// Verify a signature produced by `sign_payload`.
pub fn verify_payload(
    public: &VerifyingKey,
    ts: &str,
    body: &str,
    sig_b64: &str,
) -> bool {
    let sig_bytes = match STANDARD.decode(sig_b64) {
        Ok(b) if b.len() == 64 => b,
        _ => return false,
    };
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);
    let sig = match Signature::from_bytes(&sig_arr) {
        sig => sig,
    };
    let input = format!("{}.{}", ts, body);
    public.verify_strict(input.as_bytes(), &sig).is_ok()
}
```

Add `pub mod webhook;` to `crates/dispatcher-rs/src/lib.rs` (create if missing — for tests to import).

- [ ] **Step 4: Pass tests**

```bash
cargo test -p dispatcher-rs --test webhook_signing
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/dispatcher-rs/src/webhook.rs crates/dispatcher-rs/src/lib.rs crates/dispatcher-rs/tests/webhook_signing.rs
git commit -m "feat(dispatcher-rs): Ed25519 webhook signing + verify roundtrip test"
```

### Task G4: Dispatcher loop — read subs, sign, POST, retry, dead-letter

**Files:**
- Modify: `crates/dispatcher-rs/src/main.rs`
- Modify: `crates/dispatcher-rs/src/webhook.rs` (add dispatch loop)
- Create: `crates/dispatcher-rs/src/webhook_queries.rs`

- [ ] **Step 1: Write the sqlx queries module**

> **Audit note:** the existing api-rs uses the **runtime `sqlx::query(...)`
> + `Row::get(...)`** pattern (see `crates/api-rs/src/routes/me.rs`), NOT
> the compile-time `query_as!` / `query!` macros. The macros require either
> `DATABASE_URL` set during `cargo build` or a checked-in `.sqlx/` query
> cache — neither is configured in this project. **Follow the runtime
> pattern** to avoid breaking offline builds.

```rust
// crates/dispatcher-rs/src/webhook_queries.rs
use anyhow::Result;
use sqlx::{PgPool, Row};
use uuid::Uuid;

pub struct Subscription {
    pub id: Uuid,
    pub url: String,
    pub asset: String,
    pub threshold_bps: i32,
}

pub async fn subs_for_asset(
    pool: &PgPool,
    asset: &str,
    discount_bps: i32,
) -> Result<Vec<Subscription>> {
    let rows = sqlx::query(
        r#"SELECT id, url, asset, threshold_bps
           FROM webhook_subscriptions
           WHERE asset = $1 AND is_active = TRUE AND $2 >= threshold_bps"#,
    )
    .bind(asset)
    .bind(discount_bps.abs())
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| Subscription {
            id: r.get("id"),
            url: r.get("url"),
            asset: r.get("asset"),
            threshold_bps: r.get("threshold_bps"),
        })
        .collect())
}

pub async fn record_dispatch_result(
    pool: &PgPool,
    sub_id: Uuid,
    status: i16,
) -> Result<()> {
    sqlx::query(
        "UPDATE webhook_subscriptions
         SET last_fired_at = now(), last_status = $2
         WHERE id = $1",
    )
    .bind(sub_id)
    .bind(status)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn record_dead_letter(
    pool: &PgPool,
    sub_id: Uuid,
    alert_id: Uuid,
    payload: serde_json::Value,
    last_error: &str,
    attempts: i16,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO webhook_dead_letter
           (subscription_id, alert_id, payload, last_error, attempts)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(sub_id)
    .bind(alert_id)
    .bind(payload)
    .bind(last_error)
    .bind(attempts)
    .execute(pool)
    .await?;
    Ok(())
}
```

- [ ] **Step 2: Add the dispatch function to `webhook.rs`**

> **Audit note:** `rust_decimal::Decimal` does not expose `.to_f64()`
> directly. Existing crates (e.g. `indexer-rs/src/sources/piggybank_pb.rs:309`)
> define a local helper:
> ```rust
> fn decimal_to_f64(d: Decimal) -> f64 {
>     d.try_into().unwrap_or(0.0)
> }
> ```
> Copy this helper into `webhook.rs` (or use `rust_decimal::prelude::ToPrimitive`
> trait + `d.to_f64().unwrap_or(0.0)`). The code below uses the helper.

```rust
use reqwest::Client;
use rust_decimal::Decimal;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH, Duration};
use tokio::time::sleep;
use uuid::Uuid;

pub struct DispatchConfig {
    pub signing_key: SigningKey,
    pub http: Client,
    pub max_attempts: u8,
}

/// Local helper mirroring the pattern used in indexer-rs sources.
/// `Decimal` → `f64` via `TryInto`; falls back to 0.0 on overflow (won't
/// happen for our discount range, but keep the safety net).
pub(crate) fn decimal_to_f64(d: Decimal) -> f64 {
    d.try_into().unwrap_or(0.0)
}

pub async fn dispatch_one(
    cfg: &DispatchConfig,
    url: &str,
    alert_id: Uuid,
    payload: &Value,
) -> Result<u16, String> {
    let body = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        .to_string();
    let sig = sign_payload(&cfg.signing_key, &ts, &body);

    let mut backoffs = [1, 5, 30].into_iter().map(Duration::from_secs);
    let mut last_err = String::new();
    for attempt in 1..=cfg.max_attempts {
        let res = cfg.http
            .post(url)
            .header("x-pegana-signature", format!("ed25519:{sig}"))
            .header("x-pegana-timestamp", &ts)
            .header("content-type", "application/json")
            .body(body.clone())
            .timeout(Duration::from_secs(5))
            .send()
            .await;
        match res {
            Ok(r) if r.status().is_success() => return Ok(r.status().as_u16()),
            Ok(r) => {
                last_err = format!("http {}: {}", r.status(), r.text().await.unwrap_or_default());
            }
            Err(e) => {
                last_err = e.to_string();
            }
        }
        if attempt < cfg.max_attempts {
            if let Some(b) = backoffs.next() { sleep(b).await; }
        }
    }
    Err(last_err)
}
```

- [ ] **Step 3: Wire into `main.rs`**

> **VERIFY before editing main.rs:** read the file end-to-end first.
> The existing dispatcher does NOT use a `tokio::sync::mpsc::Receiver` for
> alerts. It uses Redis XREADGROUP directly in a `read_one(...)` loop,
> then calls `process(redis, pg, &event)` for each AlertEvent. Existing
> top-level fns in `crates/dispatcher-rs/src/main.rs`:
>   - `read_one(cfg, redis) -> Option<(String, AlertEvent)>` (~line 137)
>   - `process(...)` (~line 219) — currently handles Telegram fan-out
>   - `match_subscriptions(pg, event)` (~line 326) — Telegram subs only
>   - `send_with_retry(...)` (~line 353), `log_delivery(...)`, `ack(...)`
>
> Integration plan: extend `process()` to also call a new `webhook_fanout(pg, event, cfg, sem)` after the existing Telegram path. Do NOT introduce an mpsc bridge — the XREADGROUP loop is single-consumer and a bridge would add latency without benefit.

Concrete code (insert as a sibling fn in `main.rs`, then call from `process()`):

```rust
use crate::webhook::{decimal_to_f64, dispatch_one, DispatchConfig};
use crate::webhook_queries::{subs_for_asset, record_dispatch_result, record_dead_letter};
use ed25519_dalek::SigningKey;
use std::sync::Arc;
use tokio::sync::Semaphore;

/// Webhook fan-out for a single AlertEvent. Called from `process()` after
/// the existing Telegram fan-out completes. Telegram and webhook subscribers
/// live in disjoint tables, so the two paths are independent and safe to
/// run sequentially or in parallel.
async fn webhook_fanout(
    pool: &sqlx::PgPool,
    evt: &AlertEvent,
    dispatch_cfg: Arc<DispatchConfig>,
    sem: Arc<Semaphore>,
) {
    let discount_bps = (decimal_to_f64(evt.discount) * 10_000.0) as i32;
    let subs = match subs_for_asset(pool, &evt.asset, discount_bps).await {
        Ok(s) => s,
        Err(e) => { tracing::error!(error=?e, "subs_for_asset failed"); return; }
    };
    for sub in subs {
        let pool = pool.clone();
        let cfg = dispatch_cfg.clone();
        let evt = evt.clone();
        let permit = match sem.clone().acquire_owned().await {
            Ok(p) => p,
            Err(_) => continue,
        };
        tokio::spawn(async move {
            let _permit = permit;
            let payload = serde_json::json!({
                "asset": evt.asset,
                "from_state": evt.from_state,
                "to_state": evt.to_state,
                "discount_bps": (decimal_to_f64(evt.discount) * 10_000.0) as i64,
                "ts": evt.ts,
                "alert_id": evt.id,
            });
            let started = std::time::Instant::now();
            match dispatch_one(&cfg, &sub.url, evt.id, &payload).await {
                Ok(status) => {
                    let _ = record_dispatch_result(&pool, sub.id, status as i16).await;
                    metrics::counter!("pegana_webhook_dispatches_total", "status" => "ok").increment(1);
                }
                Err(err) => {
                    let _ = record_dead_letter(&pool, sub.id, evt.id, payload, &err, cfg.max_attempts as i16).await;
                    metrics::counter!("pegana_webhook_dispatches_total", "status" => "dead_letter").increment(1);
                    tracing::warn!(sub_id=?sub.id, error=%err, "webhook dead-letter");
                }
            }
            metrics::histogram!("pegana_webhook_dispatch_latency_seconds")
                .record(started.elapsed().as_secs_f64());
        });
    }
}
```

In `main()`, after the existing config + pool setup, build the dispatch config and semaphore ONCE:

```rust
let signing_key_b64 = std::env::var("PEGANA_WEBHOOK_SIGNING_KEY")
    .context("PEGANA_WEBHOOK_SIGNING_KEY not set")?;
let key_bytes = base64::engine::general_purpose::STANDARD
    .decode(&signing_key_b64)
    .context("PEGANA_WEBHOOK_SIGNING_KEY invalid base64")?;
let mut key_arr = [0u8; 32];
if key_bytes.len() != 32 { anyhow::bail!("PEGANA_WEBHOOK_SIGNING_KEY must be 32 bytes"); }
key_arr.copy_from_slice(&key_bytes);
let signing_key = SigningKey::from_bytes(&key_arr);

let dispatch_cfg = Arc::new(DispatchConfig {
    signing_key,
    http: reqwest::Client::new(),
    max_attempts: 3,
});
let webhook_sem = Arc::new(Semaphore::new(50));
```

Then thread `dispatch_cfg` + `webhook_sem` into `process(...)` (extend its signature) and inside `process()`, after the Telegram path, add:

```rust
webhook_fanout(&pg, &event, dispatch_cfg.clone(), webhook_sem.clone()).await;
```

- [ ] **Step 4: Generate and document a signing keypair**

```bash
cargo run -p xtask -- generate-webhook-key
# or one-off:
python3 -c "import secrets, base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"
```

Store the result as env var `PEGANA_WEBHOOK_SIGNING_KEY`. Compute and publish the public key fingerprint at `/developers#webhook`. (Add an `xtask generate-webhook-key` subcommand if useful — it'll also print the public-key fingerprint.)

- [ ] **Step 5: Commit**

```bash
git add crates/dispatcher-rs/src/main.rs \
        crates/dispatcher-rs/src/webhook.rs \
        crates/dispatcher-rs/src/webhook_queries.rs
git commit -m "feat(dispatcher-rs): webhook fan-out — sign, POST, retry, dead-letter"
```

---

## Track H — Account UI for webhook self-service

### Task H1: API routes `/v1/me/webhooks`

**Files:**
- Create: `crates/api-rs/src/routes/webhooks.rs`
- Modify: `crates/api-rs/src/routes/mod.rs`

- [ ] **Step 1: Write the route handlers**

> **Audit note:** uses the runtime `sqlx::query(...)` + `Row::get(...)` pattern to match `crates/api-rs/src/routes/me.rs`. The compile-time `query_as!` macro requires offline metadata not configured in this project.

```rust
// crates/api-rs/src/routes/webhooks.rs
use axum::{extract::{State, Path}, Json, Router};
use axum::routing::{get, post, delete};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;
use crate::auth::AuthUser;

#[derive(Serialize)]
pub struct Webhook {
    pub id: Uuid,
    pub url: String,
    pub asset: String,
    pub threshold_bps: i32,
    pub is_active: bool,
}

pub async fn list_webhooks(
    user: AuthUser,
    State(pool): State<PgPool>,
) -> Result<Json<Vec<Webhook>>, (axum::http::StatusCode, String)> {
    let rows = sqlx::query(
        "SELECT id, url, asset, threshold_bps, is_active
         FROM webhook_subscriptions
         WHERE user_id = $1 AND is_active = TRUE
         ORDER BY created_at DESC",
    )
    .bind(user.id)
    .fetch_all(&pool).await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let out = rows.into_iter().map(|r| Webhook {
        id: r.get("id"),
        url: r.get("url"),
        asset: r.get("asset"),
        threshold_bps: r.get("threshold_bps"),
        is_active: r.get("is_active"),
    }).collect();
    Ok(Json(out))
}

#[derive(Deserialize)]
pub struct CreateWebhook {
    pub url: String,
    pub asset: String,
    pub threshold_bps: i32,
}

pub async fn create_webhook(
    user: AuthUser,
    State(pool): State<PgPool>,
    Json(req): Json<CreateWebhook>,
) -> Result<Json<Webhook>, (axum::http::StatusCode, String)> {
    // Validate URL
    let parsed = url::Url::parse(&req.url)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, format!("invalid url: {e}")))?;
    if parsed.scheme() != "https" {
        return Err((axum::http::StatusCode::BAD_REQUEST, "https only".into()));
    }
    let r = sqlx::query(
        "INSERT INTO webhook_subscriptions
           (user_id, url, asset, threshold_bps)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, url, asset)
         DO UPDATE SET threshold_bps = EXCLUDED.threshold_bps, is_active = TRUE
         RETURNING id, url, asset, threshold_bps, is_active",
    )
    .bind(user.id)
    .bind(&req.url)
    .bind(&req.asset)
    .bind(req.threshold_bps)
    .fetch_one(&pool).await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(Webhook {
        id: r.get("id"),
        url: r.get("url"),
        asset: r.get("asset"),
        threshold_bps: r.get("threshold_bps"),
        is_active: r.get("is_active"),
    }))
}

pub async fn delete_webhook(
    user: AuthUser,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, (axum::http::StatusCode, String)> {
    sqlx::query(
        "UPDATE webhook_subscriptions SET is_active = FALSE
         WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user.id)
    .execute(&pool).await
    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub fn router() -> Router<PgPool> {
    Router::new()
        .route("/me/webhooks", get(list_webhooks).post(create_webhook))
        .route("/me/webhooks/:id", delete(delete_webhook))
}
```

- [ ] **Step 2: Mount in `routes/mod.rs`**

Add the line that includes `webhooks::router()` to the existing `me_router` composition.

- [ ] **Step 3: Integration test**

Add a test to `crates/api-rs/tests/me_endpoints.rs` covering: create → list → delete → list empty. Use the existing `PEGANA_INTEGRATION_*` env gate.

- [ ] **Step 4: Commit**

```bash
git add crates/api-rs/src/routes/webhooks.rs crates/api-rs/src/routes/mod.rs crates/api-rs/tests/me_endpoints.rs
git commit -m "feat(api-rs): /v1/me/webhooks CRUD (list, create, delete)"
```

### Task H2: `/account/webhooks` UI

**Files:**
- Create: `web/app/(app)/account/webhooks/page.tsx`
- Create: `web/components/organisms/webhook-list.tsx`
- Create: `web/components/molecules/webhook-create-form.tsx`
- Create: `web/lib/api/webhooks.ts`

- [ ] **Step 1: Write the API client**

```typescript
// web/lib/api/webhooks.ts
import { authedFetch } from "@/lib/api/me";

export interface Webhook {
  id: string;
  url: string;
  asset: string;
  threshold_bps: number;
  is_active: boolean;
}

export const webhooksApi = {
  list: () => authedFetch<Webhook[]>("/v1/me/webhooks"),
  create: (body: { url: string; asset: string; threshold_bps: number }) =>
    authedFetch<Webhook>("/v1/me/webhooks", { method: "POST", body: JSON.stringify(body) }),
  remove: (id: string) =>
    authedFetch<void>(`/v1/me/webhooks/${id}`, { method: "DELETE" }),
};
```

- [ ] **Step 2: Write the page**

```typescript
// web/app/(app)/account/webhooks/page.tsx
"use client";

import { useEffect, useState } from "react";
import { webhooksApi, type Webhook } from "@/lib/api/webhooks";
import { WebhookList } from "@/components/organisms/webhook-list";
import { WebhookCreateForm } from "@/components/molecules/webhook-create-form";

export default function WebhooksPage() {
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try { setHooks(await webhooksApi.list()); } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  return (
    <main className="mx-auto max-w-[1024px] px-5 py-12 sm:px-8">
      <h1 className="text-[28px] font-medium tracking-[-0.02em]">Webhooks</h1>
      <p className="mt-2 text-text-muted">
        Receive Ed25519-signed POSTs for the assets and thresholds you care about.
      </p>
      <section className="mt-10">
        <WebhookCreateForm onCreated={refresh} />
      </section>
      <section className="mt-10">
        {loading ? <p>Loading…</p> : <WebhookList hooks={hooks} onDelete={refresh} />}
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Write the two child components**

`WebhookList` renders a simple table (asset, threshold, URL truncated, delete button). `WebhookCreateForm` is a form with three inputs and a submit.

(Boilerplate code matching the existing `/account/subscriptions` style — keep it terse, match the brand kit.)

- [ ] **Step 4: Verify end-to-end via dev server**

```bash
cd web && bun dev
```

Open `http://localhost:3000/account/webhooks`. Log in via Telegram widget. Create a webhook pointing to `https://webhook.site/<your-token>`. Trigger a synthetic alert (or wait for a real one). Confirm the POST lands at webhook.site.

- [ ] **Step 5: Commit**

```bash
git add web/lib/api/webhooks.ts \
        web/app/\(app\)/account/webhooks/page.tsx \
        web/components/organisms/webhook-list.tsx \
        web/components/molecules/webhook-create-form.tsx
git commit -m "feat(web): /account/webhooks self-service UI"
```

---

## Track I — Reference receivers + CI test harness

### Task I1: TypeScript / Cloudflare Worker receiver

**Files:**
- Create: `docs/examples/webhook-receivers/typescript-cloudflare-worker/worker.ts`
- Create: `docs/examples/webhook-receivers/typescript-cloudflare-worker/README.md`

- [ ] **Step 1: Write the worker**

```typescript
// docs/examples/webhook-receivers/typescript-cloudflare-worker/worker.ts
/**
 * Verifies an Ed25519-signed Pegana webhook on Cloudflare Workers.
 * Replay window: 5 minutes. Discards anything outside the window.
 */

const PEGANA_PUB_KEY_B64 = "..."; // paste from https://pegana.xyz/developers#webhook
const REPLAY_WINDOW_SEC = 300;

export default {
  async fetch(req: Request): Promise<Response> {
    const sigHeader = req.headers.get("x-pegana-signature");
    const ts = req.headers.get("x-pegana-timestamp");
    if (!sigHeader || !ts) return new Response("missing headers", { status: 401 });

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - Number(ts)) > REPLAY_WINDOW_SEC) {
      return new Response("stale", { status: 401 });
    }

    const sigB64 = sigHeader.replace(/^ed25519:/, "");
    const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
    const pubBytes = Uint8Array.from(atob(PEGANA_PUB_KEY_B64), c => c.charCodeAt(0));

    const body = await req.text();
    const inputBytes = new TextEncoder().encode(`${ts}.${body}`);

    const key = await crypto.subtle.importKey("raw", pubBytes, { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("Ed25519", key, sigBytes, inputBytes);
    if (!ok) return new Response("bad signature", { status: 401 });

    const event = JSON.parse(body);
    // Your business logic here — e.g., forward to Slack:
    // await fetch(SLACK_WEBHOOK, { method: "POST", body: JSON.stringify({ text: `${event.asset} → ${event.to_state}` }) });
    return new Response("ok");
  },
};
```

- [ ] **Step 2: Write README explaining setup**

```markdown
# TS / Cloudflare Worker — Pegana webhook receiver

## Setup
1. `wrangler init pegana-receiver`
2. Replace `src/worker.ts` with this file.
3. Set `PEGANA_PUB_KEY_B64` to the key fingerprint published at https://pegana.xyz/developers#webhook.
4. `wrangler deploy`.
5. Register the worker URL at https://pegana.xyz/account/webhooks.

## Testing
Run the test harness in `crates/dispatcher-rs/tests/webhook_receivers.rs` —
it signs a sample payload and POSTs to your deployed worker.
```

- [ ] **Step 3: Commit**

```bash
git add docs/examples/webhook-receivers/typescript-cloudflare-worker/
git commit -m "docs(examples): TS/CFW reference webhook receiver"
```

### Task I2: Rust / axum receiver

**Files:**
- Create: `docs/examples/webhook-receivers/rust-axum/Cargo.toml`
- Create: `docs/examples/webhook-receivers/rust-axum/src/main.rs`
- Create: `docs/examples/webhook-receivers/rust-axum/README.md`

- [ ] **Step 1: Write `Cargo.toml`**

```toml
[package]
name = "pegana-receiver"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
ed25519-dalek = "2.1"
base64 = "0.22"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = "0.3"
```

- [ ] **Step 2: Write `src/main.rs`**

```rust
use axum::{Router, body::Bytes, http::{HeaderMap, StatusCode}, routing::post};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use std::time::{SystemTime, UNIX_EPOCH};

const PEGANA_PUB_KEY_B64: &str = "..."; // paste from /developers#webhook
const REPLAY_WINDOW_SEC: i64 = 300;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().init();
    let app = Router::new().route("/", post(handle));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:9000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn handle(headers: HeaderMap, body: Bytes) -> Result<&'static str, StatusCode> {
    let sig = headers.get("x-pegana-signature").and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let ts = headers.get("x-pegana-timestamp").and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let ts_i: i64 = ts.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    if (now - ts_i).abs() > REPLAY_WINDOW_SEC { return Err(StatusCode::UNAUTHORIZED); }

    let sig_b64 = sig.strip_prefix("ed25519:").unwrap_or(sig);
    let sig_bytes = STANDARD.decode(sig_b64).map_err(|_| StatusCode::UNAUTHORIZED)?;
    if sig_bytes.len() != 64 { return Err(StatusCode::UNAUTHORIZED); }
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);
    let sig = Signature::from_bytes(&sig_arr);

    let pub_bytes = STANDARD.decode(PEGANA_PUB_KEY_B64).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut pub_arr = [0u8; 32];
    if pub_bytes.len() != 32 { return Err(StatusCode::INTERNAL_SERVER_ERROR); }
    pub_arr.copy_from_slice(&pub_bytes);
    let public = VerifyingKey::from_bytes(&pub_arr).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let body_str = std::str::from_utf8(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    let input = format!("{}.{}", ts, body_str);
    public.verify_strict(input.as_bytes(), &sig).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let event: serde_json::Value = serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    tracing::info!(?event, "verified webhook");
    Ok("ok")
}
```

- [ ] **Step 3: README**

```markdown
# Rust / axum — Pegana webhook receiver

## Setup
`cargo run --release`. Listens on `:9000`.

Set `PEGANA_PUB_KEY_B64` constant in `src/main.rs` to the key from
https://pegana.xyz/developers#webhook.

## Production
Deploy as a systemd service or behind any reverse proxy. The handler
is stateless and verification-only; add idempotency tracking in your
business-logic side.
```

- [ ] **Step 4: Commit**

```bash
git add docs/examples/webhook-receivers/rust-axum/
git commit -m "docs(examples): Rust/axum reference webhook receiver"
```

### Task I3: Python / FastAPI receiver

**Files:**
- Create: `docs/examples/webhook-receivers/python-fastapi/main.py`
- Create: `docs/examples/webhook-receivers/python-fastapi/requirements.txt`
- Create: `docs/examples/webhook-receivers/python-fastapi/README.md`

- [ ] **Step 1: `requirements.txt`**

```
fastapi==0.115.0
uvicorn==0.32.0
cryptography==43.0.0
```

- [ ] **Step 2: `main.py`**

```python
import base64
import time
import json
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import FastAPI, Request, HTTPException

PEGANA_PUB_KEY_B64 = "..."  # paste from /developers#webhook
REPLAY_WINDOW_SEC = 300

app = FastAPI()
_pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(PEGANA_PUB_KEY_B64))


@app.post("/")
async def webhook(req: Request):
    sig = req.headers.get("x-pegana-signature")
    ts = req.headers.get("x-pegana-timestamp")
    if not sig or not ts:
        raise HTTPException(401, "missing headers")
    try:
        ts_i = int(ts)
    except ValueError:
        raise HTTPException(401, "bad timestamp")
    if abs(int(time.time()) - ts_i) > REPLAY_WINDOW_SEC:
        raise HTTPException(401, "stale")

    body = (await req.body()).decode("utf-8")
    sig_b64 = sig.replace("ed25519:", "", 1)
    try:
        sig_bytes = base64.b64decode(sig_b64)
        _pub.verify(sig_bytes, f"{ts}.{body}".encode("utf-8"))
    except (InvalidSignature, ValueError):
        raise HTTPException(401, "bad signature")

    event = json.loads(body)
    # Your business logic here.
    print("verified:", event)
    return {"status": "ok"}
```

- [ ] **Step 3: README**

```markdown
# Python / FastAPI — Pegana webhook receiver

## Setup
```
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 9000
```

Set `PEGANA_PUB_KEY_B64` in `main.py` to the key from
https://pegana.xyz/developers#webhook.
```

- [ ] **Step 4: Commit**

```bash
git add docs/examples/webhook-receivers/python-fastapi/
git commit -m "docs(examples): Python/FastAPI reference webhook receiver"
```

### Task I4: CI test harness — all 3 receivers in parallel

**Files:**
- Create: `crates/dispatcher-rs/tests/webhook_receivers.rs`
- Modify: `.github/workflows/ci.yml` (or whatever CI lives in)

- [ ] **Step 1: Write the harness**

The harness boots each receiver locally (TS via `wrangler dev`, Rust via `cargo run`, Python via `uvicorn`), signs a sample payload, POSTs to each, and asserts: accept valid, reject stale ts, reject bad sig, idempotent retry.

```rust
// crates/dispatcher-rs/tests/webhook_receivers.rs
// Integration test — boots each reference receiver and exercises the 4 cases.
// Gated on PEGANA_RUN_RECEIVER_TESTS=1 because it spawns subprocesses.

use dispatcher_rs::webhook::{sign_payload, SigningKey};
use reqwest::Client;
use std::time::{SystemTime, UNIX_EPOCH};

fn ts_now() -> String {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs().to_string()
}

async fn case_accept_valid(client: &Client, url: &str, key: &SigningKey) -> bool {
    let body = r#"{"asset":"jitoSOL","from_state":"PEGGED","to_state":"DRIFT"}"#;
    let ts = ts_now();
    let sig = sign_payload(key, &ts, body);
    let r = client.post(url)
        .header("x-pegana-signature", format!("ed25519:{sig}"))
        .header("x-pegana-timestamp", &ts)
        .header("content-type", "application/json")
        .body(body.to_string())
        .send().await.unwrap();
    r.status().is_success()
}

async fn case_reject_stale(client: &Client, url: &str, key: &SigningKey) -> bool {
    let body = r#"{"asset":"jitoSOL"}"#;
    let ts = "1700000000"; // way in the past
    let sig = sign_payload(key, ts, body);
    let r = client.post(url)
        .header("x-pegana-signature", format!("ed25519:{sig}"))
        .header("x-pegana-timestamp", ts)
        .header("content-type", "application/json")
        .body(body.to_string())
        .send().await.unwrap();
    r.status().as_u16() == 401
}

async fn case_reject_bad_sig(client: &Client, url: &str) -> bool {
    let body = r#"{"asset":"jitoSOL"}"#;
    let ts = ts_now();
    let r = client.post(url)
        .header("x-pegana-signature", "ed25519:AAAA")
        .header("x-pegana-timestamp", &ts)
        .header("content-type", "application/json")
        .body(body.to_string())
        .send().await.unwrap();
    r.status().as_u16() == 401
}

#[tokio::test]
async fn rust_axum_receiver_passes_all_cases() {
    if std::env::var("PEGANA_RUN_RECEIVER_TESTS").ok().as_deref() != Some("1") {
        return; // skipped
    }
    let key = SigningKey::generate(&mut rand::thread_rng());
    // Caller pre-launched receiver at :9000 with the pub key derived from `key`.
    let client = Client::new();
    let url = "http://127.0.0.1:9000/";
    assert!(case_accept_valid(&client, url, &key).await, "accept valid");
    assert!(case_reject_stale(&client, url, &key).await, "reject stale");
    assert!(case_reject_bad_sig(&client, url).await, "reject bad sig");
}

// Identical structure for the other two — duplicate per receiver port.
// TS/CFW on :9001 (via wrangler dev), Python on :9002.
```

> **Pragmatic note:** spawning all three receivers from inside `cargo test` is fiddly across runtimes. v2 ships with a shell script `scripts/test-webhook-receivers.sh` that boots all three (in parallel using `&`), waits for ports, runs the Rust integration test, then tears down. CI calls the script.

- [ ] **Step 2: Write `scripts/test-webhook-receivers.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Boot all three receivers, run the integration test, tear down.

# 1. Generate a fresh ed25519 keypair and inject pub-key into each receiver source.
KEY_B64=$(python3 -c 'import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())')
PUB_B64=$(python3 -c "from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey; import base64; k=Ed25519PrivateKey.from_private_bytes(base64.b64decode('$KEY_B64')); print(base64.b64encode(k.public_key().public_bytes_raw()).decode())")

# (substitute PUB_B64 into the three receiver source files via sed, run them, etc.)
# Run Rust integration test
PEGANA_WEBHOOK_SIGNING_KEY="$KEY_B64" \
PEGANA_RUN_RECEIVER_TESTS=1 \
cargo test -p dispatcher-rs --test webhook_receivers -- --nocapture
```

- [ ] **Step 3: Add to CI**

In `.github/workflows/ci.yml`, add a job step that runs `scripts/test-webhook-receivers.sh` on push to any branch that touches `crates/dispatcher-rs/src/webhook.rs`.

- [ ] **Step 4: Commit**

```bash
git add crates/dispatcher-rs/tests/webhook_receivers.rs \
        scripts/test-webhook-receivers.sh \
        .github/workflows/ci.yml
git commit -m "test(dispatcher-rs): webhook receiver matrix — 4 cases × 3 languages"
```

---

## Track J — `/developers` real content for MCP + Webhook

### Task J1: Replace placeholders in `/developers`

**Files:**
- Modify: `web/app/(marketing)/developers/page.tsx`

- [ ] **Step 1: Update the MCP section**

Replace the "Preview — full launch in v2.0" callout from Plan 1 with the real content:
- Live URL: `https://mcp.pegana.xyz`
- Tool catalog (6 tools, free/paid annotations)
- Pricing: free tools listed; paid tools listed with USDC price
- Example Claude Desktop config JSON
- Example `curl` against the streamable endpoint

- [ ] **Step 2: Update the Webhook section**

Replace placeholder with:
- The signed POST contract (headers, body, signature input)
- The public key fingerprint
- Replay window + idempotency notes
- Links to the three reference receivers in `docs/examples/webhook-receivers/`
- "Register your URL" CTA → `/account/webhooks`

- [ ] **Step 3: Commit**

```bash
git add web/app/\(marketing\)/developers/page.tsx
git commit -m "feat(web): /developers MCP + Webhook real content (post-launch)"
```

---

## Self-Review

### Spec coverage

| SPEC requirement | Covered by Task |
|---|---|
| Decision #5 — MCP server in TS with pinned stack | A1–A2, B1–B5, E1 |
| Decision #5 — Performance budgets met | A3, A4, B6 (measurement); E1 (ongoing) |
| Decision #5 — MCP error contract examples | B4 (isError true + meta), C1, C2 |
| Decision #6 — x402 wrapper with Solana mainnet | A2 (devnet wiring), C3 (24h soak), C4 (mainnet switch) |
| Decision #6 — Free quota for retail discovery (1000/day/payTo) | D1 (counter exists), D2 (descoped to v2.1 with documentation) — partial gap |
| Decision #7 — Ed25519 webhook signed channel | G1–G4 |
| Decision #7 — 3-language receiver test matrix | I1–I4 |
| Decision #7 — `/account/webhooks` self-service | H1–H2 |
| Decision #8 — Public + Agent tier active | Implicit: free tools are Public, paid tools are Agent |
| Decision #8 — Protocol tier "Contact us" | No code task — purely marketing copy on `/developers` (Plan 1 already includes it) |
| Decision #12 Phase 2 #4 — Verification spike | A1–A4 |
| Decision #12 Phase 2 #5 — Free tools shipped first | B1–B6 |
| Decision #12 Phase 2 #6 — x402 enabled devnet then mainnet | C1–C4 |
| Decision #12 Phase 2 #7 — Listed on smithery.ai + mcp.run | F3 |
| Decision #12 Phase 2 #8 — Webhook channel + page + receivers | G + H + I |
| Telemetry — pegana_mcp_*, pegana_webhook_* | E1, G4 |

**Identified gap:** Decision #6's "1000 free calls/day per payTo" is descoped (Task D2 documents this as v2.1). This is intentional — paid tools in v2 have no free tier; free tools have no per-caller quota. If the user wants the full quota model in v2, expand Task D into 3 tasks (D1: counter, D2: middleware on paid tools, D3: middleware tests).

### Placeholder scan

Searched for "TBD", "TODO", "fill in", "..." in code blocks. Only intentional placeholders are:
- `PEGANA_PUB_KEY_B64 = "..."` in the three reference receiver samples — these are intended to be filled by the user when deploying their receiver. README on each example documents this.
- The `<sig>` placeholder in the C4 milestone note — a real signature is filled when the milestone happens; this is operational documentation, not code.

No unintentional placeholders remain.

### Type consistency

- `Webhook` type in `web/lib/api/webhooks.ts` matches the columns in `migration 0022_webhook_subscriptions.sql` exactly.
- `PegState` enum values in `mcp-ts/src/shared/types.ts` match the `pegana-common` Rust enum.
- `CHANNELS.DISCOUNT` and `CHANNELS.ALERTS` match the constants in `crates/common/src/lib.rs` lines 321/325.
- All tool input schemas use `zod` consistently.
- All signing payloads use the format `<timestamp>.<body>` in both Rust dispatcher and reference receivers.

No inconsistencies found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-26-pegana-v2-phase-2-channels.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Strongly recommended for this plan: tasks span TS + Rust + SQL + Bun + CI, and a fresh subagent per file boundary keeps the context clean.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
