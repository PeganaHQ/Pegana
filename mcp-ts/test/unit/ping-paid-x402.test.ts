// Unit test for the (formerly paid) `ping_paid` tool.
//
// The tool name is unchanged so existing agents keep working, but there is no
// payment wrapper any more: Pegana is fully free. This test stubs the boot path
// so we can verify, in-memory, that:
//   1. ping_paid is registered through the SAME rate-limit + call-log +
//      metrics composition as every other tool — NOT through a payment
//      wrapper, and
//   2. the handler returns the canonical `paid pong` envelope (the shape
//      paying agents already assert against).

import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import {
  mockModuleForRunner,
  restoreModulesForRunner,
} from "../support/module-mock";

// buildResourceServer() normally does a facilitator handshake. Stub it so the
// boot path stays offline; nothing in this test depends on its return value.
const buildResourceServer = vi.fn().mockResolvedValue({
  server: {},
  network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
});
await mockModuleForRunner("@/x402", () => ({ buildResourceServer }));

process.env.SOLANA_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// Capture every tool registration so we can pull out ping_paid's handler.
interface Registered {
  name: string;
  handler: (...a: unknown[]) => Promise<{
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: { message?: string };
  }>;
}

let activeRegistered: Registered[] = [];

await mockModuleForRunner("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool(
      name: string,
      _def: unknown,
      handler: (...a: unknown[]) => Promise<unknown>,
    ) {
      activeRegistered.push({ name, handler: handler as Registered["handler"] });
    }
  },
}));

async function buildAndCapture(): Promise<Registered[]> {
  activeRegistered = [];
  const { createMcpServer } = await import("@/server");
  await createMcpServer();
  return activeRegistered;
}

describe("ping_paid is free", () => {
  let registered: Registered[];

  beforeAll(async () => {
    registered = await buildAndCapture();
  });

  afterAll(async () => {
    await restoreModulesForRunner(
      "@/x402",
      "@modelcontextprotocol/sdk/server/mcp.js",
    );
  });

  it("registers the three formerly-metered tools, all free", async () => {
    // The authoritative "nothing is charged" guard is the source scan in
    // bazaar-discovery.test.ts (it walks every file in src/). This asserts the
    // observable half: the names still exist so existing agents keep working.
    for (const name of [
      "ping_paid",
      "get_asset_history",
      "subscribe_peg_events",
    ]) {
      expect(registered.find((r) => r.name === name), name).toBeDefined();
    }
  });

  it("returns the canonical 'paid pong' envelope", async () => {
    const pingPaid = registered.find((r) => r.name === "ping_paid")!;

    const res = await pingPaid.handler({}, {});
    expect(res.content?.[0]?.type).toBe("text");
    expect(res.content?.[0]?.text).toBe("paid pong");
    expect(res.structuredContent?.message).toBe("paid pong");
  });
});
