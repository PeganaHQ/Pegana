import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";

vi.mock("@/x402", () => ({
  buildResourceServer: vi.fn().mockResolvedValue({
    server: {},
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  }),
}));

let app: Hono;
let MAX_BODY_BYTES: number;
let TRANSPORT_MAX_BODY_BYTES: number;

beforeAll(async () => {
  process.env.SOLANA_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  const mod = await import("@/transport");
  MAX_BODY_BYTES = mod.MAX_BODY_BYTES;
  TRANSPORT_MAX_BODY_BYTES = mod.TRANSPORT_MAX_BODY_BYTES;
  app = await mod.buildApp();
});

const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

describe("HTTP transport", () => {
  it("rejects a request body over the cap with 413 (R1 audit idx 67)", async () => {
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_asset_state",
        arguments: { symbol: "x".repeat(MAX_BODY_BYTES) },
      },
    });
    const res = await app.request("/", {
      method: "POST",
      headers: MCP_HEADERS,
      body: big,
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32600);
  });

  // R2 audit idx 18/56: with Bun's maxRequestBodySize equal to the app cap,
  // Bun answered an empty 413 and reset the connection, which Caddy surfaced
  // as an empty 502. The transport ceiling must leave the app cap in charge.
  it("keeps the Bun transport ceiling far above the JSON-RPC body cap", () => {
    expect(TRANSPORT_MAX_BODY_BYTES).toBeGreaterThanOrEqual(16 * MAX_BODY_BYTES);
  });

  // Literal sizes: it.each runs before beforeAll imports MAX_BODY_BYTES (64 KiB).
  it.each([64 * 1024 + 1, 128 * 1024, 2 * 1024 * 1024])(
    "answers a %i-byte Content-Length body with a JSON-RPC 413",
    async (size) => {
      const res = await app.request("/", {
        method: "POST",
        headers: { ...MCP_HEADERS, "content-length": String(size) },
        body: "a".repeat(size),
      });
      expect(res.status).toBe(413);
      const body = (await res.json()) as { jsonrpc: string; error: { code: number; message: string } };
      expect(body.jsonrpc).toBe("2.0");
      expect(body.error.code).toBe(-32600);
      expect(body.error.message).toContain(String(MAX_BODY_BYTES));
    },
  );

  it.each(["DELETE", "PUT", "PATCH"])("answers %s / with 405 Allow: POST", async (method) => {
    const res = await app.request("/", { method });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32000);
  });

  it("still serves a normal JSON-RPC call", async () => {
    const res = await app.request("/", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("get_asset_state");
  });

  it("answers GET / asking for SSE with 405, not HTML", async () => {
    const res = await app.request("/", {
      headers: { accept: "text/event-stream" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("serves the landing page to browsers without internal endpoints or retired channels", async () => {
    const res = await app.request("/", {
      headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Pegana MCP server");
    expect(html).not.toContain("/metrics");
    expect(html).not.toContain("t.me/");
    expect(html).not.toContain("ReplayCLI");
    expect(html).not.toMatch(/x402|\$0\./);
    expect(html).not.toContain("—"); // no em-dashes in user-facing copy
  });
});
