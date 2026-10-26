// R2 audit idx 21 / 54: tool inputs that used to reach Postgres unvalidated
// came back as RAW driver errors (`timestamp out of range: "1e+300"`,
// `invalid byte sequence for encoding "UTF8": 0x00`). Inputs are now bounded
// at the schema boundary, and any error a handler still throws is replaced
// with a generic message (withSafeErrors). Wired through the real McpServer +
// SDK Client so the whole middleware stack is exercised.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("@/x402", () => ({
  buildResourceServer: vi.fn().mockResolvedValue({
    server: {},
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  }),
}));

const PG_ERROR = 'invalid byte sequence for encoding "UTF8": 0x00';
const dbQuery = vi.fn(async (sql: string) => {
  if (sql.includes("mcp_call_log")) return { rows: [] };
  throw new Error(PG_ERROR);
});

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  const db = { query: dbQuery } as unknown as import("pg").Pool;
  return {
    ...actual,
    pool: () => db,
    fetchHistory: (asset: string, bucket: import("@/db").HistoryBucket, limit: number) =>
      actual.fetchHistory(asset, bucket, limit, db),
  };
});

let client: Client;

beforeAll(async () => {
  process.env.SOLANA_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { createMcpServer } = await import("@/server");
  const server = await createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "input-hardening-test", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

beforeEach(() => {
  dbQuery.mockClear();
});

function dataQueries(): number {
  return dbQuery.mock.calls.filter(([sql]) => !String(sql).includes("mcp_call_log")).length;
}

async function callText(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0]!.text;
  return { isError: res.isError === true, text };
}

describe("input hardening", () => {
  it("rejects a NUL byte in get_asset_history's symbol before any DB query", async () => {
    const { isError, text } = await callText("get_asset_history", { symbol: "x\u0000" });
    expect(isError).toBe(true);
    expect(text).toMatch(/\[A-Za-z0-9\._\+\*-\]/);
    expect(text).not.toMatch(/invalid byte sequence|UTF8/);
    expect(dataQueries()).toBe(0);
  });

  it("applies the same symbol charset to every symbol-taking tool", async () => {
    for (const [name, args] of [
      ["get_asset_state", { symbol: "USDC'--" }],
      ["get_methodology", { symbol: "a b" }],
      ["get_loop_exposure", { symbol: "../x" }],
      ["simulate_depeg_impact", { symbol: "x\u0000", shock_bps: 500 }],
      ["subscribe_peg_events", { symbols: ["USDC", "x\u0000"], since_ts: 0 }],
    ] as const) {
      const { isError, text } = await callText(name, args);
      expect(isError, name).toBe(true);
      expect(text, name).toMatch(/symbol must be/);
    }
    expect(dataQueries()).toBe(0);
  });

  it.each([1e300, -5, 1_792_500_662_000])(
    "rejects since_ts=%d at the schema, never reaching Postgres",
    async (since_ts) => {
      const { isError, text } = await callText("subscribe_peg_events", {
        symbols: ["USDC"],
        since_ts,
      });
      expect(isError).toBe(true);
      expect(text).toMatch(/since_ts/);
      expect(text).not.toMatch(/timestamp out of range/);
      expect(dataQueries()).toBe(0);
    },
  );

  it("masks a DB error a handler throws with a generic message", async () => {
    const hist = await callText("get_asset_history", { symbol: "USDC" });
    expect(hist.isError).toBe(true);
    expect(hist.text).toMatch(/get_asset_history failed with an internal error/);
    expect(hist.text).not.toContain(PG_ERROR);

    const ev = await callText("subscribe_peg_events", { symbols: ["USDC"], since_ts: 0 });
    expect(ev.isError).toBe(true);
    expect(ev.text).toMatch(/subscribe_peg_events failed with an internal error/);
    expect(ev.text).not.toContain(PG_ERROR);
  });

  // R2 audit idx 23b: the published inputSchemas say additionalProperties:
  // false, but extra keys were silently stripped and the call succeeded.
  it("rejects unknown argument keys, matching the published additionalProperties: false", async () => {
    const { tools } = await client.listTools();
    const methodology = tools.find((t) => t.name === "get_methodology")!;
    expect(methodology.inputSchema).toMatchObject({ additionalProperties: false });
    const { isError, text } = await callText("get_methodology", { symbol: "jitoSOL", extra: 1 });
    expect(isError).toBe(true);
    expect(text).toMatch(/Unrecognized key.*extra/);
  });

  it("still accepts a zero-argument tool called with no arguments", async () => {
    const { isError, text } = await callText("ping", {});
    expect(isError).toBe(false);
    expect(text).toMatch(/pong/);
  });
});
