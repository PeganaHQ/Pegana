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
import { withConformedOutput } from "@/middleware/conform-output";
import { withSafeErrors } from "@/middleware/safe-errors";

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

// Everything registerTool needs from a tool module.
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  outputSchema: z.ZodRawShape;
  annotations: ToolAnnotations & { title: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, extra?: unknown) => Promise<any>;
}

/**
 * The published JSON Schema for a raw shape says `additionalProperties: false`,
 * but the SDK parses arguments with a default (stripping) zod object, so an
 * unknown argument was silently dropped instead of rejected (R2 audit idx
 * 23b). A strict object makes validation match the published contract: an
 * extra key is an "Input validation error". Zero-argument tools keep the raw
 * empty shape (published as the SDK's plain empty-object schema).
 */
export function strictInput(shape: z.ZodRawShape): z.ZodRawShape | z.ZodObject {
  return Object.keys(shape).length > 0 ? z.object(shape).strict() : shape;
}

/**
 * Register one free tool with the shared middleware stack, outermost first:
 * rate limit (100/min per caller IP) -> safe errors (a thrown error becomes a
 * generic isError result, never the raw driver text; see
 * @/middleware/safe-errors) -> call log -> metrics -> output conformance
 * (structuredContent stripped to exactly the published schema, see
 * @/middleware/conform-output).
 */
function registerFreeTool(mcp: McpServer, tool: ToolDefinition): void {
  mcp.registerTool(
    tool.name,
    {
      title: tool.annotations.title,
      description: tool.description,
      inputSchema: strictInput(tool.inputSchema),
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
    },
    withRateLimit(
      tool.name,
      withSafeErrors(
        tool.name,
        withCallLog(
          tool.name,
          withMetrics(
            tool.name,
            withConformedOutput(tool.outputSchema, tool.handler),
          ),
        ),
      ),
    ),
  );
}

// `ping_paid` predates the free tier. The name and its `paid pong` reply are
// kept so existing agents and docs keep working; it is free like every tool.
const pingPaidTool: ToolDefinition = {
  name: "ping_paid",
  description:
    "Legacy alias of `ping`, kept so existing agents keep working. Returns `paid pong` in both `content` and `structuredContent.message`; free, no payment involved. For plain liveness use `ping`.",
  inputSchema: {},
  outputSchema: {
    message: z.string().describe("Always `paid pong`."),
  },
  annotations: {
    title: "Ping (legacy alias)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async () => ({
    content: [{ type: "text" as const, text: "paid pong" }],
    structuredContent: { message: "paid pong" },
  }),
};

/** Every registered tool, in tools/list order. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  pingTool,
  getAssetsTool,
  getAssetStateTool,
  getMethodologyTool,
  getLoopExposureTool,
  simulateDepegTool,
  verifyAlertTool,
  pingPaidTool,
  getAssetHistoryTool,
  subscribePegEventsTool,
];

/**
 * Per-request McpServer factory. Cheap: every tool is free, so there is
 * nothing per-request to build beyond the registrations themselves. Call
 * `initSharedState()` once at boot.
 */
export async function createMcpServer(): Promise<McpServer> {
  await initSharedState();

  const mcp = new McpServer({
    name: "pegana-oracle",
    version: "0.1.0",
  });
  for (const tool of TOOL_DEFINITIONS) registerFreeTool(mcp, tool);
  return mcp;
}
