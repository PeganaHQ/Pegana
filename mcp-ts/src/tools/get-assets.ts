// Free tool — returns every asset currently in the Redis-warmed cache.
//
// Output is a structured `{ count, assets[] }` payload. The legacy
// `content[0].text` carries the same JSON for backwards-compatible
// clients that haven't migrated to structuredContent.

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { getAllCachedStates } from "@/redis";

const PEG_STATES = [
  "PEGGED",
  "DRIFT",
  "DEPEG",
  "CRITICAL",
  "BLACK_SWAN",
  "UNKNOWN",
] as const;

const assetSnapshot = z.object({
  asset: z.string(),
  state: z.enum(PEG_STATES),
  discount: z
    .string()
    .describe(
      "Signed decimal as string: negative = ABOVE intrinsic (a premium), positive = BELOW (a discount). E.g. `-0.0042` = 42bps above intrinsic (a premium). String preserves Postgres NUMERIC precision.",
    ),
  intrinsic_usd: z.string(),
  market_usd: z.string(),
  ts: z.number().int().describe("Unix seconds at the snapshot timestamp."),
});

export const getAssetsTool = {
  name: "get_assets",
  description:
    "Free. Lists every asset currently tracked by Pegana with its real-time peg state. " +
    "Returns `{ count, assets: [{ asset, state, discount, intrinsic_usd, market_usd, ts }, ...] }` " +
    "where `state` is one of `PEGGED | DRIFT | DEPEG | CRITICAL | BLACK_SWAN | UNKNOWN`, " +
    "`discount` = 1 − market/intrinsic, a signed decimal string: negative = ABOVE intrinsic (a premium), positive = BELOW (a discount) — e.g. `-0.0042` = 42bps above intrinsic (a premium); `ts` is unix seconds. " +
    "Call this once at session start to discover the live supported symbols across LSTs, fiat stablecoins, " +
    "yield-bearing tokens, CDPs, FX-pegged, and synthetics. " +
    "Use `get_asset_state` for a single symbol if you already know it — that path is cheaper.",
  inputSchema: {},
  outputSchema: {
    count: z
      .number()
      .int()
      .nonnegative()
      .describe("Number of assets currently in the cache."),
    assets: z.array(assetSnapshot),
  },
  annotations: {
    title: "List tracked assets",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } satisfies ToolAnnotations,
  async handler() {
    const assets = getAllCachedStates();
    const structured = { count: assets.length, assets };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(structured, null, 2) },
      ],
      structuredContent: structured,
    };
  },
};
