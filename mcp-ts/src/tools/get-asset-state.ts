// Free tool — current state for a single asset, with stale detection.
//
// Conforms to the SPEC error contract: isError=true when the asset
// isn't tracked OR when the cache entry is older than 5 minutes. The
// `_meta.lastFreshSec` field carries the staleness so an agent can
// decide whether to retry or proceed with stale data. structuredContent
// is emitted only on the happy path — MCP skips outputSchema validation
// when isError=true (SDK behaviour).

import { symbolSchema } from "@/shared/symbol";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { getCachedState } from "@/redis";
import { isNonPublicSymbol, missingSnapshotMessage } from "@/shared/asset-registry";
import {
  ageSeconds,
  snapshotShape,
  STALE_AFTER_SEC,
} from "@/shared/snapshot-schema";

export const getAssetStateTool = {
  name: "get_asset_state",
  description:
    "Free. Returns the current peg state for a single tracked asset on Solana. " +
    "On success, `structuredContent` is `{ asset, state, discount, intrinsic_usd, market_usd, ts, updated_at }`: " +
    "`state` is one of `PEGGED | DRIFT | DEPEG | CRITICAL | BLACK_SWAN | UNKNOWN`, " +
    "`discount` = 1 − market/intrinsic, signed: NEGATIVE = trading ABOVE intrinsic (a premium), POSITIVE = trading BELOW intrinsic (a discount), as a decimal string; prices are USD as strings, `ts` is unix seconds and `updated_at` the same instant in ISO-8601. " +
    "Example: `{ symbol: \"jitoSOL\" }` → current state of Jito's jitoSOL LST. " +
    "Returns `isError: true` with `_meta.lastFreshSec` if the cached state is older than 5 minutes, " +
    "or if there is no live snapshot for the symbol; the error text says whether the symbol is tracked but has no snapshot yet, is listed but inactive, or is not tracked at all (call `get_assets` to enumerate symbols with live data). " +
    "Prefer this over `get_assets` when you already know the symbol: it skips the full enumeration.",
  inputSchema: {
    symbol: symbolSchema()
      .describe(
        "Case-sensitive asset symbol as published by Pegana. Examples: `jitoSOL`, `mSOL`, `INF`, `USDC`, `USDT`, `PYUSD`, `USDe`, `USDS`, `hyUSD`. Run `get_assets` to enumerate the live list.",
      ),
  },
  outputSchema: snapshotShape,
  annotations: {
    title: "Get current peg state for one asset",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } satisfies ToolAnnotations,
  async handler(args: { symbol: string }) {
    // Off-surface classes (xSOL) are not tracked publicly; REST answers 404.
    const snap = isNonPublicSymbol(args.symbol) ? undefined : getCachedState(args.symbol);
    if (!snap) {
      return {
        content: [
          {
            type: "text" as const,
            text: missingSnapshotMessage(args.symbol),
          },
        ],
        isError: true,
      };
    }
    const ageSec = ageSeconds(snap.ts);
    if (ageSec > STALE_AFTER_SEC) {
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
