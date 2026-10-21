import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
let MAX_BATCH_SIZE: number;
let MESSAGE_RATE_LIMIT_PER_MIN: number;
let resetRateLimits: () => void;

beforeAll(async () => {
  process.env.SOLANA_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  const mod = await import("@/transport");
  MAX_BODY_BYTES = mod.MAX_BODY_BYTES;
  TRANSPORT_MAX_BODY_BYTES = mod.TRANSPORT_MAX_BODY_BYTES;
  MAX_BATCH_SIZE = mod.MAX_BATCH_SIZE;
  const rl = await import("@/middleware/rate-limit");
  MESSAGE_RATE_LIMIT_PER_MIN = rl.MESSAGE_RATE_LIMIT_PER_MIN;
  resetRateLimits = rl._resetForTests;
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

describe("JSON-RPC batch cap and per-message rate limit (R3 audit SEC-R3-03)", () => {
  const listEntry = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/list" });
  const post = (body: unknown, ip: string) =>
    app.request("/", {
      method: "POST",
      headers: { ...MCP_HEADERS, "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  beforeEach(() => resetRateLimits());

  it("refuses a batch over the cap with one -32600 error and runs no entry", async () => {
    const batch = Array.from({ length: 150 }, (_, i) => listEntry(i + 1));
    const res = await post(batch, "203.0.113.10");
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      jsonrpc: string;
      id: null;
      error: { code: number; message: string; data: { max_batch_size: number } };
    };
    expect(Array.isArray(body)).toBe(false);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBeNull();
    expect(body.error.code).toBe(-32600);
    expect(body.error.message).toContain("batch too large");
    expect(body.error.data.max_batch_size).toBe(MAX_BATCH_SIZE);
  });

  it("refuses a batch of MAX_BATCH_SIZE + 1", async () => {
    const batch = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => listEntry(i + 1));
    const res = await post(batch, "203.0.113.11");
    expect(res.status).toBe(400);
  });

  it("still serves a batch of exactly MAX_BATCH_SIZE", async () => {
    const batch = Array.from({ length: MAX_BATCH_SIZE }, (_, i) => listEntry(i + 1));
    const res = await post(batch, "203.0.113.12");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("get_asset_state");
  });

  it("counts every batch entry against the per-IP message limit", async () => {
    const ip = "203.0.113.13";
    const batch = Array.from({ length: MAX_BATCH_SIZE }, (_, i) => listEntry(i + 1));
    const allowedPosts = Math.floor(MESSAGE_RATE_LIMIT_PER_MIN / MAX_BATCH_SIZE);
    for (let i = 0; i < allowedPosts; i++) {
      const res = await post(batch, ip);
      expect(res.status).toBe(200);
    }
    const over = await post(listEntry(42), ip);
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBe("60");
    const body = (await over.json()) as {
      id: unknown;
      error: { code: number; data: { error: string; limit_per_min: number } };
    };
    // A single request's id is echoed so the client can correlate the error.
    expect(body.id).toBe(42);
    expect(body.error.code).toBe(-32000);
    expect(body.error.data.error).toBe("rate_limited");
    expect(body.error.data.limit_per_min).toBe(MESSAGE_RATE_LIMIT_PER_MIN);

    // A batch or a notification has no single id to echo.
    const overBatch = (await (await post([listEntry(1), listEntry(2)], ip)).json()) as { id: unknown };
    expect(overBatch.id).toBeNull();
    const overNote = (await (
      await post({ jsonrpc: "2.0", method: "notifications/initialized" }, ip)
    ).json()) as { id: unknown };
    expect(overNote.id).toBeNull();
    const overStr = (await (await post({ ...listEntry(1), id: "abc" }, ip)).json()) as { id: unknown };
    expect(overStr.id).toBe("abc");

    // Another IP is unaffected.
    const other = await post(listEntry(1), "203.0.113.14");
    expect(other.status).toBe(200);
  });

  it("rate-limits non-tool methods and failed validations, not only tools/call", async () => {
    const ip = "203.0.113.15";
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "t", version: "0" },
      },
    };
    const badCall = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_asset_state", arguments: { nope: 1 } },
    };
    for (let i = 0; i < MESSAGE_RATE_LIMIT_PER_MIN / 2; i++) {
      expect((await post(init, ip)).status).toBe(200);
      expect((await post(badCall, ip)).status).toBe(200);
    }
    expect((await post(init, ip)).status).toBe(429);
    expect((await post(badCall, ip)).status).toBe(429);
  });

  it("still answers invalid JSON with the SDK parse error", async () => {
    const res = await post("{not json", "203.0.113.16");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it("exposes Retry-After to browser clients via CORS", async () => {
    const res = await app.request("/", {
      method: "POST",
      headers: { ...MCP_HEADERS, origin: "https://example.com", "x-forwarded-for": "203.0.113.17" },
      body: JSON.stringify(listEntry(1)),
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-expose-headers")?.toLowerCase()).toContain("retry-after");
  });
});
