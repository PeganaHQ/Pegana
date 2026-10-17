import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server", () => ({
  createMcpServer: vi.fn(),
  initSharedState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/metrics", () => ({
  renderProm: vi.fn().mockReturnValue(""),
}));

import { buildApp } from "@/transport";

// Every tool is free. The manifest is the surface an agent reads to see the
// whole catalogue and its (zero) price before calling anything.
const expectedManifest = {
  name: "Pegana Oracle MCP",
  version: "0.1.0",
  endpoint: "https://mcp.pegana.xyz/",
  transport: "streamable-http",
  documentation: "https://docs.pegana.xyz/guides/mcp",
  privacy: "https://www.pegana.xyz/privacy",
  tools: "10 free",
  toolList: [
    { name: "ping", price: "free", description: "Liveness probe; returns pong and server uptime." },
    { name: "get_assets", price: "free", description: "List every tracked asset with its current peg state." },
    { name: "get_asset_state", price: "free", description: "Current intrinsic-vs-market state for one asset." },
    { name: "get_loop_exposure", price: "free", description: "Cross-protocol leverage exposure for one asset (advisory)." },
    { name: "simulate_depeg_impact", price: "free", description: "Depeg liquidation-cascade estimate on a preset shock grid." },
    { name: "get_methodology", price: "free", description: "Per-class peg-mechanism and scoring methodology." },
    { name: "verify_alert", price: "free", description: "Fetch a public audit receipt by alert UUID." },
    { name: "ping_paid", price: "free", description: "Liveness probe that also exercises the MCP call path." },
    { name: "get_asset_history", price: "free", description: "Bucketed discount time-series, up to 50k rows." },
    { name: "subscribe_peg_events", price: "free", description: "Peg state-transition events with a lossless cursor." },
  ],
};

describe("MCP discovery manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves the manifest as JSON", async () => {
    const app = await buildApp();
    const response = await app.request("/.well-known/mcp.json");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json\b/);
    await expect(response.json()).resolves.toEqual(expectedManifest);
  });
});
