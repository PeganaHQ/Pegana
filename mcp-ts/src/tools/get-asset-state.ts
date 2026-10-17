// Free tool — current state for a single asset, with stale detection.
//
// Conforms to the SPEC error contract: isError=true when the asset
// isn't tracked OR when the cache entry is older than 5 minutes. The
// `_meta.lastFreshSec` field carries the staleness so an agent can
// decide whether to retry or proceed with stale data. structuredContent
// is emitted only on the happy path — MCP skips outputSchema validation
// when isError=true (SDK behaviour).

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { getCachedState } from "@/redis";

const PEG_STATES = [
  "PEGGED",
  "DRIFT",
  "DEPEG",
  "CRITICAL",
  "BLACK_SWAN",
  "UNKNOWN",
] as const;

export const getAssetStateTool = {
  name: "get_asset_state",
  description:
    "Free. Returns the current peg state for a single tracked asset on Solana. " +
    "On success, `structuredContent` is `{ asset, state, discount, intrinsic_usd, market_usd, ts }` — " +
    "`state` is one of `PEGGED | DRIFT | DEPEG | CRITICAL | BLACK_SWAN | UNKNOWN`, " +
    "`discount` = 1 − market/intrinsic, signed: NEGATIVE = trading ABOVE intrinsic (a premium), POSITIVE = trading BELOW intrinsic (a discount) — a decimal string; prices are USD as strings, `ts` is unix seconds. " +
    "Example: `{ symbol: \"jitoSOL\" }` → current state of Jito's jitoSOL LST. " +
    "Returns `isError: true` with `_meta.lastFreshSec` if the cached state is older than 5 minutes, " +
    "or if the symbol is not tracked (call `get_assets` first to enumerate valid symbols). " +
    "Prefer this over `get_assets` when you already know the symbol — it skips the full enumeration.",
  inputSchema: {
    symbol: z
      .string()
      .min(1)
      .max(20)
      .describe(
        "Case-sensitive asset symbol as published by Pegana. Examples: `jitoSOL`, `mSOL`, `INF`, `USDC`, `USDT`, `PYUSD`, `USDe`, `sUSDe`, `USDS`, `hyUSD`. Run `get_assets` to enumerate the live list.",
      ),
  },
  outputSchema: {
    asset: z.string(),
    state: z.enum(PEG_STATES),
    discount: z
      .string()
      .describe(
        "Signed decimal as string: negative = ABOVE intrinsic (a premium), positive = BELOW (a discount). E.g. `-0.0042` = 42bps above intrinsic (a premium).",
      ),
    intrinsic_usd: z.string(),
    market_usd: z.string(),
    ts: z.number().int().describe("Unix seconds at the snapshot timestamp."),
  },
  annotations: {
    title: "Get current peg state for one asset",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } satisfies ToolAnnotations,
  async handler(args: { symbol: string }) {
    const snap = getCachedState(args.symbol);
    if (!snap) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: asset '${args.symbol}' not tracked. Use get_assets() to list tracked symbols.`,
          },
        ],
        isError: true,
      };
    }
    const ageSec = Math.floor(Date.now() / 1000 - snap.ts);
    if (ageSec > 300) {
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(snap, null, 2) },
        ],
        isError: true,
        _meta: { state: "UNKNOWN" as const, lastFreshSec: ageSec },
      };
    }
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(snap, null, 2) },
      ],
      structuredContent: { ...snap },
    };
  },
};
