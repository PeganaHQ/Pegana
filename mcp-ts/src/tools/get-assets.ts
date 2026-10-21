// Free tool — returns every asset currently in the Redis-warmed cache.
//
// Output is a structured `{ count, assets[] }` payload. The legacy
// `content[0].text` carries the same JSON for backwards-compatible
// clients that haven't migrated to structuredContent.

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { getAllCachedStates } from "@/redis";
import { isNonPublicSymbol } from "@/shared/asset-registry";
import {
  ageSeconds,
  snapshotShape,
  STALE_AFTER_SEC,
} from "@/shared/snapshot-schema";

const assetSnapshot = z.object({
  ...snapshotShape,
  stale: z
    .boolean()
    .describe(
      `True when the snapshot is older than ${STALE_AFTER_SEC}s: the engine has not recomputed this asset recently, so treat state and discount as last-known, not live.`,
    ),
});

/**
 * True for assets left out of the public list, mirroring REST /v1/assets
 * (crates/api-rs/src/routes/assets.rs, `a.class::text <> 'synth_lev'`).
 * Leveraged synthetics (xSOL) have no peg: a leveraged junior tranche trades
 * far from its NAV by design, so its "discount" is a leverage premium, and
 * listing it as `PEGGED` with a -36% discount reads as broken (R2 audit idx 19).
 * REST now 404s them on every /v1/assets route, and so do the per-symbol MCP tools.
 */
function excludedFromList(symbol: string): boolean {
  return isNonPublicSymbol(symbol);
}

export const getAssetsTool = {
  name: "get_assets",
  description:
    "Free. Lists every asset currently tracked by Pegana with its real-time peg state. " +
    "Returns `{ count, assets: [{ asset, state, discount, intrinsic_usd, market_usd, ts, updated_at, stale }, ...] }` " +
    "where `state` is one of `PEGGED | DRIFT | DEPEG | CRITICAL | BLACK_SWAN | UNKNOWN`, " +
    "`discount` = 1 − market/intrinsic, a signed decimal string: negative = ABOVE intrinsic (a premium), positive = BELOW (a discount), e.g. `-0.0042` = 42bps above intrinsic (a premium); `ts` is unix seconds, `updated_at` the same instant in ISO-8601; `stale` is true when the snapshot is older than 5 minutes. " +
    "Call this once at session start to discover the live supported symbols across LSTs, fiat stablecoins, " +
    "yield-bearing tokens, CDPs, FX-pegged, and delta-neutral synthetics. " +
    "Leveraged synthetics (class `synth_lev`, e.g. xSOL) are left out, exactly as in REST `/v1/assets`: they have no peg, so their market-vs-NAV gap is a leverage premium, not a peg deviation. Per-symbol tools report them as not tracked, as REST answers 404. " +
    "Use `get_asset_state` for a single symbol if you already know it; it returns just that snapshot.",
  inputSchema: {},
  outputSchema: {
    count: z
      .number()
      .int()
      .nonnegative()
      .describe("Number of assets returned (live cache entries, leveraged synthetics excluded)."),
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
    const now = Date.now();
    const assets = getAllCachedStates()
      .filter((snap) => !excludedFromList(snap.asset))
      .map((snap) => ({
        ...snap,
        stale: ageSeconds(snap.ts, now) > STALE_AFTER_SEC,
      }));
    const structured = { count: assets.length, assets };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(structured, null, 2) },
      ],
      structuredContent: structured,
    };
  },
};
