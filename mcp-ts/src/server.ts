// MCP server factory.
//
// The streamable-HTTP transport mounts a fresh McpServer per request
// (stateless mode in transport.ts). Re-running the facilitator handshake on
// every call would be wasteful, so the resource server is built once at boot
// and cached at module scope; createMcpServer() is the cheap per-request
// factory.
//
// Every tool is FREE. Pegana is fully open, so there is no payment wrapper,
// no payTo address and no settlement path: all ten tools are registered with
// the same rate-limit + call-log + metrics composition.
//
// ADR-0011 middleware: withRateLimit + withCallLog caps per-agent abuse at
// 100 calls/min (no Caddy-level limit exists; this is the only one) and lands
// usage telemetry in mcp_call_log.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { buildResourceServer } from "@/x402";
import { pingTool } from "@/tools/ping";
import { getAssetsTool } from "@/tools/get-assets";
import { getAssetStateTool } from "@/tools/get-asset-state";
import { getMethodologyTool } from "@/tools/get-methodology";
import { getLoopExposureTool } from "@/tools/get-loop-exposure";
import { simulateDepegTool } from "@/tools/simulate-depeg";
import { getAssetHistoryTool } from "@/tools/get-asset-history";
import { subscribePegEventsTool } from "@/tools/subscribe-peg-events";
import { verifyAlertTool } from "@/tools/verify-alert";
import { withMetrics } from "@/metrics";
import { withRateLimit, withCallLog } from "@/middleware";

interface SharedMcpState {
  /** Kept for the Bazaar discovery extension registration (see @/x402). */
  resourceServerInitialized: true;
}

let cachedState: SharedMcpState | null = null;

/**
 * One-shot initialization of the (now payment-free) x402 resource server.
 *
 * Nothing is charged any more, but the resource server still registers the
 * Bazaar discovery extension, and building it once at boot keeps that wiring
 * warm for a future paid tier. Idempotent.
 */
export async function initSharedState(): Promise<SharedMcpState> {
  if (cachedState) return cachedState;
  await buildResourceServer();
  cachedState = { resourceServerInitialized: true };
  return cachedState;
}

/**
 * Per-request McpServer factory. Cheap — every tool is free, so there is
 * nothing per-request to build beyond the registrations themselves. Call
 * `initSharedState()` once at boot.
 */
export async function createMcpServer(): Promise<McpServer> {
  await initSharedState();

  const mcp = new McpServer({
    name: "pegana-oracle",
    version: "0.1.0",
  });

  // ── Free tools ────────────────────────────────────────────────────
  // All free tools are rate-limited (100/min/agent — fingerprinted by
  // source IP since no x402 payment header is present) so the unmetered
  // free surface can't be abused. withCallLog telemeters usage to
  // mcp_call_log; same `withRateLimit(withCallLog(...))` composition as
  // verify_alert below.
  mcp.registerTool(
    pingTool.name,
    {
      title: pingTool.annotations.title,
      description: pingTool.description,
      inputSchema: pingTool.inputSchema,
      outputSchema: pingTool.outputSchema,
      annotations: pingTool.annotations,
    },
    withRateLimit(
      pingTool.name,
      withCallLog(pingTool.name, withMetrics(pingTool.name, pingTool.handler)),
    ),
  );
  mcp.registerTool(
    getAssetsTool.name,
    {
      title: getAssetsTool.annotations.title,
      description: getAssetsTool.description,
      inputSchema: getAssetsTool.inputSchema,
      outputSchema: getAssetsTool.outputSchema,
      annotations: getAssetsTool.annotations,
    },
    withRateLimit(
      getAssetsTool.name,
      withCallLog(
        getAssetsTool.name,
        withMetrics(getAssetsTool.name, getAssetsTool.handler),
      ),
    ),
  );
  mcp.registerTool(
    getAssetStateTool.name,
    {
      title: getAssetStateTool.annotations.title,
      description: getAssetStateTool.description,
      inputSchema: getAssetStateTool.inputSchema,
      outputSchema: getAssetStateTool.outputSchema,
      annotations: getAssetStateTool.annotations,
    },
    withRateLimit(
      getAssetStateTool.name,
      withCallLog(
        getAssetStateTool.name,
        withMetrics(getAssetStateTool.name, getAssetStateTool.handler),
      ),
    ),
  );
  mcp.registerTool(
    getMethodologyTool.name,
    {
      title: getMethodologyTool.annotations.title,
      description: getMethodologyTool.description,
      inputSchema: getMethodologyTool.inputSchema,
      outputSchema: getMethodologyTool.outputSchema,
      annotations: getMethodologyTool.annotations,
    },
    withRateLimit(
      getMethodologyTool.name,
      withCallLog(
        getMethodologyTool.name,
        withMetrics(getMethodologyTool.name, getMethodologyTool.handler),
      ),
    ),
  );
  mcp.registerTool(
    getLoopExposureTool.name,
    {
      title: getLoopExposureTool.annotations.title,
      description: getLoopExposureTool.description,
      inputSchema: getLoopExposureTool.inputSchema,
      outputSchema: getLoopExposureTool.outputSchema,
      annotations: getLoopExposureTool.annotations,
    },
    withRateLimit(
      getLoopExposureTool.name,
      withCallLog(
        getLoopExposureTool.name,
        withMetrics(getLoopExposureTool.name, getLoopExposureTool.handler),
      ),
    ),
  );
  mcp.registerTool(
    simulateDepegTool.name,
    {
      title: simulateDepegTool.annotations.title,
      description: simulateDepegTool.description,
      inputSchema: simulateDepegTool.inputSchema,
      outputSchema: simulateDepegTool.outputSchema,
      annotations: simulateDepegTool.annotations,
    },
    withRateLimit(
      simulateDepegTool.name,
      withCallLog(
        simulateDepegTool.name,
        withMetrics(simulateDepegTool.name, simulateDepegTool.handler),
      ),
    ),
  );
  // verify_alert is free per ADR-0011 but rate-limited (100/min/agent)
  // and telemetered to mcp_call_log so we still get a usage signal.
  mcp.registerTool(
    verifyAlertTool.name,
    {
      title: verifyAlertTool.annotations.title,
      description: verifyAlertTool.description,
      inputSchema: verifyAlertTool.inputSchema,
      // Audit C P1: declared so MCP clients can rely on structuredContent.
      // Without this, the SDK silently drops/warns on structuredContent.
      outputSchema: verifyAlertTool.outputSchema,
      annotations: verifyAlertTool.annotations,
    },
    withRateLimit(
      verifyAlertTool.name,
      withCallLog(
        verifyAlertTool.name,
        withMetrics(verifyAlertTool.name, verifyAlertTool.handler),
      ),
    ),
  );

  // ── Formerly-paid tools (now free) ────────────────────────────────
  // The tool names are unchanged so existing agents keep working; only the
  // payment wrapper is gone. All three get the same rate-limit + call-log +
  // metrics composition as every other tool.
  const pingPaidAnnotations = {
    title: "Ping (MCP smoke test)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } satisfies ToolAnnotations;
  mcp.registerTool(
    "ping_paid",
    {
      title: pingPaidAnnotations.title,
      description:
        "Returns `paid pong` in both `content` and `structuredContent.message`. Smoke test for the MCP call path. Free; for plain liveness use `ping`.",
      inputSchema: {},
      outputSchema: {
        message: z.string().describe("Always `paid pong`."),
      },
      annotations: pingPaidAnnotations,
    },
    withRateLimit(
      "ping_paid",
      withCallLog(
        "ping_paid",
        withMetrics("ping_paid", async () => ({
          content: [{ type: "text" as const, text: "paid pong" }],
          structuredContent: { message: "paid pong" },
        })),
      ),
    ),
  );
  mcp.registerTool(
    getAssetHistoryTool.name,
    {
      title: getAssetHistoryTool.annotations.title,
      description: getAssetHistoryTool.description,
      inputSchema: getAssetHistoryTool.inputSchema,
      outputSchema: getAssetHistoryTool.outputSchema,
      annotations: getAssetHistoryTool.annotations,
    },
    withRateLimit(
      getAssetHistoryTool.name,
      withCallLog(
        getAssetHistoryTool.name,
        withMetrics(getAssetHistoryTool.name, getAssetHistoryTool.handler),
      ),
    ),
  );
  mcp.registerTool(
    subscribePegEventsTool.name,
    {
      title: subscribePegEventsTool.annotations.title,
      description: subscribePegEventsTool.description,
      inputSchema: subscribePegEventsTool.inputSchema,
      outputSchema: subscribePegEventsTool.outputSchema,
      annotations: subscribePegEventsTool.annotations,
    },
    withRateLimit(
      subscribePegEventsTool.name,
      withCallLog(
        subscribePegEventsTool.name,
        withMetrics(
          subscribePegEventsTool.name,
          subscribePegEventsTool.handler,
        ),
      ),
    ),
  );

  return mcp;
}
