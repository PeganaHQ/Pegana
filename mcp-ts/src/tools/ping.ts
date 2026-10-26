// Free health-check tool. Returns "pong" + server uptime in seconds.

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export const pingTool = {
  name: "ping",
  description:
    "Free liveness probe for the Pegana oracle MCP server. Returns the string `pong (Ns)` where N is the number of seconds since the server booted, plus a `structuredContent` payload with `{ message, uptime_sec }`. Use this to confirm the endpoint is reachable before issuing real tool calls; it makes no DB or Redis read.",
  inputSchema: {},
  outputSchema: {
    message: z
      .string()
      .describe("Always `pong`. Confirms the server responded."),
    uptime_sec: z
      .number()
      .int()
      .nonnegative()
      .describe("Seconds since the MCP server boot (process.uptime, rounded)."),
  },
  annotations: {
    title: "Ping (free health check)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } satisfies ToolAnnotations,
  async handler() {
    const uptime = Math.round(process.uptime());
    return {
      content: [{ type: "text" as const, text: `pong (${uptime}s)` }],
      structuredContent: { message: "pong", uptime_sec: uptime },
    };
  },
};
