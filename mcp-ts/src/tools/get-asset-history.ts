// Free tool — time-series of intrinsic-vs-market discount for one asset.
//
// Hits Postgres directly (no cache) since the rows are bucketed and
// historical. Bucket sizes match what the dashboard uses: 1m / 5m /
// 15m / 1h. Returns most-recent first; capped to 50_000 rows at the
// SQL layer regardless of the requested `limit`.
//
// Lookback is hard-bounded to 30 days at the SQL layer (`ts > now() -
// interval '30 days'`): rows older than 30 days are NEVER returned,
// regardless of `limit` or `bucket`. A large `limit` does not reach
// further back in time — it only widens the cap within that 30-day
// window. To chart older history, use the buffered on-chain receipts /
// replay bundles instead.

import { z } from "zod";
import { symbolSchema } from "@/shared/symbol";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { fetchHistory, type HistoryBucket, type HistoryRow } from "@/db";
import { isNonPublicSymbol, missingSnapshotMessage, registryEntry } from "@/shared/asset-registry";

const historyRow = z.object({
  ts: z
    .string()
    .describe(
      "Bucket start as ISO-8601 UTC with milliseconds, e.g. `2026-10-21T01:25:00.000Z` (same format as REST).",
    ),
  discount: z
    .string()
    .describe(
      "Signed decimal string averaged over the bucket, rounded to 6 dp: negative = ABOVE intrinsic (a premium), positive = BELOW (a discount).",
    ),
  intrinsic_usd: z.string(),
  market_usd: z.string(),
});

export const getAssetHistoryTool = {
  name: "get_asset_history",
  description:
    "Free. Returns a bucketed time-series of intrinsic-vs-market discount for one asset. " +
    "`structuredContent` is `{ symbol, bucket, count, rows: [{ ts, discount, intrinsic_usd, market_usd }, ...] }`: `ts` is the bucket start in ISO-8601 UTC (e.g. `2026-10-21T01:25:00.000Z`), prices and discount are decimal strings, discount is signed. " +
    "Example: `{ symbol: \"jitoSOL\", bucket: \"5m\", limit: 288 }` → last 24h of jitoSOL discount at 5-minute resolution. " +
    "Use this to detect trends (gradual drift vs. sudden depeg), backtest peg-aware strategies, or chart history. " +
    "For *current* state only, use `get_asset_state` instead. Rows are returned most-recent first; SQL hard-caps at 50,000 regardless of `limit`. Lookback window is 30 days: rows older than 30 days are NEVER returned regardless of `limit` or `bucket`; a larger `limit` widens the cap, it does not reach further back in time.",
  inputSchema: {
    symbol: symbolSchema()
      .describe(
        "Case-sensitive asset symbol. Same set as `get_asset_state` (run `get_assets` to enumerate).",
      ),
    bucket: z
      .enum(["1m", "5m", "15m", "1h"])
      .default("1m")
      .describe(
        "Time-bucket resolution. `1m` = highest fidelity / shortest range, `1h` = lowest fidelity / longest range. Default `1m`.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50_000)
      .default(1000)
      .describe(
        "Maximum number of rows to return, most-recent first. Hard-capped at 50,000. Default 1000 (≈16h at 1m bucket).",
      ),
  },
  outputSchema: {
    symbol: z.string(),
    bucket: z.enum(["1m", "5m", "15m", "1h"]),
    count: z
      .number()
      .int()
      .nonnegative()
      .describe("Number of rows returned (≤ requested limit, ≤ 50000)."),
    rows: z.array(historyRow),
  },
  annotations: {
    title: "Get historical discount time-series",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } satisfies ToolAnnotations,
  // The MCP SDK passes RequestHandlerExtra as the 2nd argument; the handler's
  // 2nd parameter is a test seam, so never forward it.
  handler: (args: { symbol: string; bucket: HistoryBucket; limit: number }) => handleGetAssetHistory(args),
};

export async function handleGetAssetHistory(
  args: {
    symbol: string;
    bucket: HistoryBucket;
    limit: number;
  },
  fetcher: typeof fetchHistory = fetchHistory,
) {
  // Off-surface classes (xSOL) are not tracked publicly; REST answers 404.
  const rows: HistoryRow[] = isNonPublicSymbol(args.symbol)
    ? []
    : await fetcher(args.symbol, args.bucket, args.limit);
  if (rows.length === 0 && !registryEntry(args.symbol)) {
    // Same error as the other per-symbol tools, instead of a silent empty
    // series for a typo. A registry miss alone is not enough (an asset added
    // after this build still has rows), so it also requires zero rows.
    return {
      content: [{ type: "text" as const, text: missingSnapshotMessage(args.symbol) }],
      isError: true as const,
    };
  }
  const structured = {
    symbol: args.symbol,
    bucket: args.bucket,
    count: rows.length,
    rows,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}
