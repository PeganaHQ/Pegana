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
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { fetchHistory, type HistoryBucket, type HistoryRow } from "@/db";

const historyRow = z.object({
  ts: z
    .string()
    .describe(
      "ISO-8601 timestamp at the bucket start (TimescaleDB `time_bucket` output, cast to text).",
    ),
  discount: z
    .string()
    .describe(
      "Signed decimal string averaged over the bucket: negative = ABOVE intrinsic (a premium), positive = BELOW (a discount).",
    ),
  intrinsic_usd: z.string(),
  market_usd: z.string(),
});

export const getAssetHistoryTool = {
  name: "get_asset_history",
  description:
    "Free. Returns a bucketed time-series of intrinsic-vs-market discount for one asset. " +
    "`structuredContent` is `{ symbol, bucket, count, rows: [{ ts, discount, intrinsic_usd, market_usd }, ...] }` — `ts` is an ISO timestamp at the bucket start, prices and discount are decimal strings, discount is signed. " +
    "Example: `{ symbol: \"jitoSOL\", bucket: \"5m\", limit: 288 }` → last 24h of jitoSOL discount at 5-minute resolution. " +
    "Use this to detect trends (gradual drift vs. sudden depeg), backtest peg-aware strategies, or chart history. " +
    "For *current* state only, use the free `get_asset_state` instead. Rows are returned most-recent first; SQL hard-caps at 50,000 regardless of `limit`. Lookback window is 30 days: rows older than 30 days are NEVER returned regardless of `limit` or `bucket` — a larger `limit` widens the cap, it does not reach further back in time.",
  inputSchema: {
    symbol: z
      .string()
      .min(1)
      .max(20)
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
  handler: handleGetAssetHistory,
};

export async function handleGetAssetHistory(
  args: {
    symbol: string;
    bucket: HistoryBucket;
    limit: number;
  },
  fetcher: typeof fetchHistory = fetchHistory,
) {
  const rows: HistoryRow[] = await fetcher(args.symbol, args.bucket, args.limit);
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
