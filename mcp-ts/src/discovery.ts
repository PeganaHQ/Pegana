// Bazaar discovery metadata for the MCP tools.
//
// x402 facilitators expose `GET /discovery/resources`, and agents query it to
// find tools programmatically. A resource only appears there if its 402
// challenge carries a Bazaar discovery extension.
//
// Pegana is fully free today, so no tool emits a 402 challenge and none of
// these declarations is attached to a payment wrapper. They are kept (and
// kept valid) so a future paid tier can re-enable discovery by attaching them
// again; the free-tier catalogue lives in @/pricing and is served from
// /.well-known/mcp.json.
//
// What the extension can and cannot express (verified against
// @x402/extensions@2.28.0, `McpDiscoveryInfo`):
//   - it carries toolName, description, transport, inputSchema and examples;
//   - it does NOT carry a price. The price a facilitator advertises is the
//     `accepts` requirement on the same 402 response, which comes from
//     `buildPaymentRequirements` — so pricing.ts remains the single source and
//     the advertised price cannot drift from the charged one.
//
// Because discovery rides on the 402 challenge, it applies to PAID tools only.
// Free tools never emit a challenge, so they are advertised in the
// /.well-known/mcp.json manifest instead (see transport.ts), which lists every
// tool with its price, including `free`.
//
// transport: the Bazaar validator only accepts "streamable-http" or "sse"
// (VALID_MCP_TRANSPORTS) — not "https". The host is carried by the resource
// URL, which must be absolute http(s): the facilitator canonicalises it with
// `new URL(...)` and a `mcp://tool/x` URL yields origin "null" (with `tool`
// parsed as the host), so the canonicalised URL is "null/x" and cannot be indexed.

import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getAssetHistoryTool } from "@/tools/get-asset-history";
import { subscribePegEventsTool } from "@/tools/subscribe-peg-events";

/**
 * Public MCP endpoint. Overridable for staging; the default is production.
 * Trailing slash is normalised so `resource.url` never doubles it.
 */
export const MCP_ENDPOINT = (
  process.env.MCP_PUBLIC_ENDPOINT ?? "https://mcp.pegana.xyz/"
).replace(/\/+$/, "");

/** Transport name accepted by the Bazaar MCP validator. */
export const MCP_TRANSPORT = "streamable-http" as const;

/**
 * Absolute, per-tool resource URL. Every tool shares the one streamable-HTTP
 * endpoint; the `/tool/{name}` suffix is a stable catalog identifier, not a
 * routable path (a GET there returns the landing page). It keeps the three
 * paid tools distinct in the catalog and in the 402 challenge, which is the
 * B-011 requirement.
 */
export function toolResourceUrl(toolName: string): string {
  return `${MCP_ENDPOINT}/tool/${toolName}`;
}

/**
 * Turn an MCP tool's Zod input shape into the JSON Schema the discovery
 * extension wants. Deriving it from the live schema — rather than writing a
 * second copy — is what keeps the advertised contract identical to the one the
 * server enforces at call time.
 */
export function inputSchemaToJson(
  shape: Record<string, z.ZodTypeAny>,
): Record<string, unknown> {
  const { $schema: _ignored, ...json } = zodToJsonSchema(z.object(shape)) as Record<
    string,
    unknown
  >;
  return json;
}

/**
 * Discovery payloads keyed by tool name.
 */
export const TOOL_DISCOVERY: Record<string, Record<string, unknown>> = {
  get_asset_history: declareDiscoveryExtension({
    toolName: "get_asset_history",
    description:
      "Bucketed time-series of one asset's intrinsic-vs-market discount over the last 30 days.",
    transport: MCP_TRANSPORT,
    inputSchema: inputSchemaToJson(getAssetHistoryTool.inputSchema),
    example: { symbol: "jitoSOL", bucket: "5m", limit: 288 },
    output: {
      example: {
        symbol: "jitoSOL",
        bucket: "5m",
        count: 2,
        rows: [
          {
            ts: "2026-10-16T14:00:00.000Z",
            discount: "0.000420",
            intrinsic_usd: "181.4421",
            market_usd: "181.3659",
          },
          {
            ts: "2026-10-16T13:55:00.000Z",
            discount: "-0.000110",
            intrinsic_usd: "181.3902",
            market_usd: "181.4101",
          },
        ],
      },
    },
  }),

  ping_paid: declareDiscoveryExtension({
    toolName: "ping_paid",
    description:
      "Liveness probe that also exercises the MCP call path; returns `pong`.",
    transport: MCP_TRANSPORT,
    inputSchema: inputSchemaToJson({}),
    example: {},
    output: { example: { message: "paid pong" } },
  }),

  subscribe_peg_events: declareDiscoveryExtension({
    toolName: "subscribe_peg_events",
    description:
      "Batch of peg state-transition events for up to 20 assets, walked with a lossless cursor.",
    transport: MCP_TRANSPORT,
    inputSchema: inputSchemaToJson(subscribePegEventsTool.inputSchema),
    example: { symbols: ["jitoSOL", "USDe"], since_ts: 0, threshold_bps: 25 },
    output: {
      example: {
        count: 1,
        next_cursor: 1760623200.482,
        events: [
          {
            id: "9f2c1e40-5b7a-4c1e-9a3d-2b6f0c8d1e77",
            asset: "USDe",
            from_state: "PEGGED",
            to_state: "DRIFT",
            discount: "0.003120",
            ts: 1760623200.482,
            evidence_url:
              "https://pegana.xyz/audit/9f2c1e40-5b7a-4c1e-9a3d-2b6f0c8d1e77",
          },
        ],
      },
    },
  }),
};
