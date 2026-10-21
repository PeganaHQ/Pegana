// Every tool's REAL structuredContent must validate against the JSON
// outputSchema it publishes in tools/list, as checked by the official
// @modelcontextprotocol/sdk Client (AJV, `additionalProperties: false`).
//
// R1 audit idx 1: the server-side zod check strips unknown keys and passes,
// while SDK clients rejected get_assets / get_asset_state / get_loop_exposure
// ("must NOT have additional properties"), and subscribe_peg_events failed on
// a string `ts`. This test wires the real McpServer + middleware stack to the
// real SDK Client over an in-memory transport, feeds every data source the
// payload shapes production actually emits (engine Redis wire JSON, node-pg
// row types, api-rs REST bodies captured from api.pegana.xyz on 2026-10-21),
// and calls every tool listed by tools/list.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";

vi.mock("@/x402", () => ({
  buildResourceServer: vi.fn().mockResolvedValue({
    server: {},
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  }),
}));

// node-pg row shapes: text casts come back as strings; float8 as number.
// `ts` of alert events is deliberately the STRING a NUMERIC epoch would be,
// to prove the handler coerces it (the pre-fix bug).
const ALERT_ROWS = [
  {
    id: "612835d1-c19d-4b00-8a7f-2a23bce18e8a",
    asset: "USDC",
    from_state: "PEGGED",
    to_state: "DRIFT",
    discount: "0.002100",
    ts: "1792500662.543249",
  },
];
const HISTORY_ROWS = [
  {
    ts: "2026-10-21T01:47:00.000Z",
    discount: "0.000170000000000000000000",
    intrinsic_usd: "1.00000000000000000000",
    market_usd: "0.99982736000000000000",
  },
];

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM alert_events")) return { rows: ALERT_ROWS };
    if (sql.includes("FROM discount_snapshots")) return { rows: HISTORY_ROWS };
    return { rows: [] }; // mcp_call_log inserts
  });
  const db = { query } as unknown as import("pg").Pool;
  return {
    ...actual,
    pool: () => db,
    fetchHistory: (
      asset: string,
      bucket: import("@/db").HistoryBucket,
      limit: number,
    ) => actual.fetchHistory(asset, bucket, limit, db),
  };
});

const ALERT_ID = "612835d1-c19d-4b00-8a7f-2a23bce18e8a";

// Captured verbatim from api.pegana.xyz (read-only GETs, 2026-10-21), plus one
// synthetic future field on loop-exposure to pin the conformance guard.
const REST: Record<string, unknown> = {
  "/v1/assets/jitoSOL": { symbol: "jitoSOL", class: "lst" },
  "/v1/assets/jitoSOL/loop-exposure": {
    asset: "jitoSOL",
    loop_exposure_usd: "21741556.96",
    collateral_usd: "112178880.06",
    debt_usd: "1828.71",
    coverage: "partial",
    by_protocol: [
      {
        protocol: "jupiter_lend",
        collateral_lev_usd: "10942995.2",
        collateral_usd: "10942995.2",
        debt_usd: "0",
        positions: ">50",
        coverage: "full",
        ts: "2026-10-21T02:06:09.685Z",
      },
      {
        protocol: "kamino",
        collateral_lev_usd: "10798561.76",
        collateral_usd: "101235884.86",
        debt_usd: "1828.71",
        positions: ">50",
        coverage: "full",
        ts: "2026-10-21T02:06:14.552Z",
      },
    ],
    cascade: [
      { shock_bps: 100, liquidatable_usd: "0", positions: "<5" },
      { shock_bps: 2000, liquidatable_usd: "171063.01", positions: "5-20" },
    ],
    updated_at: "2026-10-21T02:06:14.552Z",
    advisory_note: "advisory model estimate — not a verifiable receipt",
    some_future_field: { added_by: "api-rs" },
  },
  // get_loop_exposure reads band-only freshness for cascade[] from here.
  "/v1/assets/jitoSOL/simulate-depeg?shock_bps=100": {
    asset: "jitoSOL",
    shock_bps: 100,
    loop_exposure_usd: "21741556.96",
    liquidatable_usd: "0",
    positions: "<5",
    coverage: "partial",
    by_protocol: [],
    advisory_note:
      "advisory model estimate — not a verifiable receipt; risky bands may be suppressed for privacy, and bad-debt/slippage is not yet modelled",
    updated_at: "2026-10-17T19:32:24.358Z",
  },
  "/v1/assets/jitoSOL/simulate-depeg?shock_bps=500": {
    asset: "jitoSOL",
    shock_bps: 500,
    loop_exposure_usd: "21741556.96",
    liquidatable_usd: "0",
    positions: "<5",
    coverage: "partial",
    by_protocol: [],
    advisory_note:
      "advisory model estimate — not a verifiable receipt; risky bands may be suppressed for privacy, and bad-debt/slippage is not yet modelled",
    updated_at: "2026-10-17T19:32:24.358Z",
  },
  [`/v1/audit/${ALERT_ID}`]: {
    alert: {
      asset: "hyloSOL+",
      class: "lst",
      confidence: "high",
      detected_at: "2026-10-20T13:51:02.543Z",
      discount: "0.005064",
      from_state: "PEGGED",
      id: ALERT_ID,
      intrinsic_usd: "104.413245656797405886",
      market_usd: "103.792205847070884450",
      to_state: "DRIFT",
    },
    evidence: {
      assets_toml_sha256:
        "5f863ba5d29557745990c8660126386a320262e1199c1fc58045f1a1d3224f0c",
      commit_status: "not_applicable",
      computed: { final_state: "DRIFT" },
      created_at: "2026-10-20T13:51:02.560Z",
      has_replay_artifact: true,
      inputs_frozen: { alpha: "0.3", asset: "hyloSOL+" },
      methodology_git_sha: "9299614a291a55f8911ef4f22f44e67529f8551f",
      methodology_version: "0.7.0",
      onchain_tx_sig: null,
      receipt_sha256:
        "b5577ae72d8bf181c1fbc78955fa4be6afaa784d956aa15cbe69f6fe63cf584e",
    },
    evidence_status: "ready",
  },
};

const fetchStub = vi.fn(async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input.toString());
  const key = url.pathname + url.search;
  const body = REST[key];
  if (body === undefined) {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

// Arguments for every tool. A tool missing here fails the coverage check.
const CALLS: Record<string, Record<string, unknown>> = {
  ping: {},
  ping_paid: {},
  get_assets: {},
  get_asset_state: { symbol: "jitoSOL" },
  get_methodology: { symbol: "jitoSOL" },
  get_loop_exposure: { symbol: "jitoSOL" },
  simulate_depeg_impact: { symbol: "jitoSOL", shock_bps: 500 },
  verify_alert: { alert_id: ALERT_ID },
  get_asset_history: { symbol: "USDC", limit: 2 },
  subscribe_peg_events: { symbols: ["USDC"], since_ts: 0 },
};

let client: Client;
let tools: Awaited<ReturnType<Client["listTools"]>>["tools"];
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  process.env.SOLANA_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  globalThis.fetch = fetchStub as unknown as typeof fetch;

  // Seed the live cache through the SAME parser the Redis subscriber uses,
  // with the engine's real wire payload (kind + nanosecond updated_at).
  const { __cacheForTests } = await import("@/redis");
  const { parseDiscountMessage } = await import("@/shared/types");
  const nowIso = new Date().toISOString().replace("Z", "536101Z");
  for (const asset of ["jitoSOL", "USDC"]) {
    const snap = parseDiscountMessage(
      JSON.stringify({
        kind: "update",
        asset,
        state: "PEGGED",
        discount: "0.0001606721854266045903365197",
        intrinsic_usd: "1",
        market_usd: "0.99982736",
        updated_at: nowIso,
      }),
    );
    __cacheForTests.set(asset, snap!);
  }

  const { createMcpServer } = await import("@/server");
  const server = await createMcpServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "conformance-test", version: "0.0.0" });
  await client.connect(clientTransport);
  // listTools() is what makes the SDK client cache an AJV validator per tool.
  tools = (await client.listTools()).tools;
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await client?.close();
});

describe("structuredContent conforms to the published outputSchema", () => {
  it("every listed tool declares an outputSchema and has a call fixture", () => {
    expect(tools.length).toBe(10);
    for (const t of tools) {
      expect(t.outputSchema, t.name).toBeDefined();
      expect(CALLS[t.name], `no fixture for ${t.name}`).toBeDefined();
    }
  });

  it.each(Object.keys(CALLS))("%s", async (name) => {
    // Client.callTool throws McpError(-32602) when structuredContent fails the
    // AJV check against the listed outputSchema.
    const res = await client.callTool({ name, arguments: CALLS[name] });
    const text = (res.content as Array<{ text?: string }>)[0]?.text;
    expect(res.isError, `${name}: ${text}`).toBeFalsy();
    expect(res.structuredContent, name).toBeDefined();

    // Belt and braces: validate again with a fresh AJV validator built from
    // the JSON Schema exactly as tools/list published it.
    const schema = tools.find((t) => t.name === name)!.outputSchema!;
    const validate = new AjvJsonSchemaValidator().getValidator(schema);
    const verdict = validate(res.structuredContent);
    expect(verdict.errorMessage, name).toBeUndefined();
    expect(verdict.valid, name).toBe(true);
  });

  it("get_loop_exposure publishes band-only cascade freshness (R1 idx 33)", async () => {
    const res = await client.callTool({
      name: "get_loop_exposure",
      arguments: { symbol: "jitoSOL" },
    });
    expect(res.structuredContent).toMatchObject({ cascade_stale: true });
  });
});
