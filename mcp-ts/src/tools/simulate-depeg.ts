// Free tool — Sub-C depeg-cascade simulator.
//
// Calls the api-rs `/v1/assets/{symbol}/simulate-depeg?shock_bps=` model (single
// Rust model). ADVISORY estimate, NOT a verifiable receipt (ADR-0036 inv.9).
// Anonymous + aggregate only; shock is restricted to a preset grid.

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { upstreamFailureText, upstreamGet } from "@/shared/upstream";
import { missingSnapshotMessage } from "@/shared/asset-registry";
import { freshness, freshnessShape } from "@/shared/snapshot-schema";
import { symbolSchema } from "@/shared/symbol";

const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";
// The source refreshes hourly (protocol-indexer-ts); 3x/2x that is stale.
const CASCADE_STALE_AFTER_SEC = 7200;
const SHOCK_GRID = [100, 250, 500, 1000, 2000] as const;

export const simulateDepegTool = {
  name: "simulate_depeg_impact",
  description:
    "Free. Estimates the cross-protocol liquidation CASCADE if an asset depegs: `{ asset, shock_bps, loop_exposure_usd, liquidatable_usd, positions, coverage, by_protocol[], advisory_note }`. " +
    "`shock_bps` MUST be one of 100|250|500|1000|2000 (a preset grid, no continuous sweep). `liquidatable_usd` = TOTAL collateral (not only the leveraged share) of the positions in health-factor bands that cross their liquidation threshold at that shock, across Kamino + Jupiter Lend. `loop_exposure_usd` is the leveraged collateral only (same as `get_loop_exposure`), so `liquidatable_usd` can exceed it; do not read their ratio as a share. " +
    "This is an ADVISORY model estimate, NOT a verifiable peg receipt; risky bands may be privacy-suppressed (coverage:partial), and slippage/bad-debt is not yet modelled. Anonymous + aggregate only (ADR-0036). `stale: true` (with `data_age_sec`) means the liquidation bands are older than 2h: treat the estimate as last-known, not current. When `coverage` is `unknown` (no fresh health-factor bands) the liquidatable amount is not known: `liquidatable_usd` and `positions` are null on API builds that report it that way, which is different from `\"0\"` (nothing liquidates). Example: { symbol: \"jitoSOL\", shock_bps: 500 }.",
  inputSchema: {
    symbol: symbolSchema().describe("Case-sensitive asset symbol (run get_assets to enumerate)."),
    shock_bps: z
      .number()
      .int()
      .refine((n) => (SHOCK_GRID as readonly number[]).includes(n), {
        message: "shock_bps must be one of 100, 250, 500, 1000, 2000",
      })
      .describe("Depeg shock in basis points. One of 100 | 250 | 500 | 1000 | 2000."),
  },
  outputSchema: {
    asset: z.string(),
    shock_bps: z.number().int(),
    loop_exposure_usd: z
      .string()
      .describe("Leveraged collateral stacked on the asset (USD decimal string), for context."),
    // Nullable (back-compatible widening): the API reports null, not "0",
    // when coverage is unknown and the liquidatable amount is not known.
    liquidatable_usd: z
      .string()
      .nullable()
      .describe(
        "Total collateral (USD decimal string) of positions in HF bands that liquidate at this shock. Not limited to the leveraged share, so it can exceed loop_exposure_usd. Null when coverage is unknown (amount not known, not zero).",
      ),
    positions: z
      .string()
      .nullable()
      .describe("Bucketed position count (e.g. `<5`, `5-20`, `>50`). Null when coverage is unknown."),
    coverage: z.string(),
    by_protocol: z.array(
      z.object({
        protocol: z.string(),
        liquidatable_usd: z.string().nullable(),
        positions: z.string().nullable(),
      }),
    ),
    advisory_note: z.string(),
    updated_at: z.string().optional(),
    ...freshnessShape("hourly", CASCADE_STALE_AFTER_SEC),
  },
  annotations: {
    title: "Simulate a depeg's liquidation cascade (advisory)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } satisfies ToolAnnotations,
  async handler(args: { symbol: string; shock_bps: number }, extra?: unknown) {
    const url = `${API_BASE}/v1/assets/${encodeURIComponent(args.symbol)}/simulate-depeg?shock_bps=${args.shock_bps}`;
    const resp = await upstreamGet(url, extra);
    if (resp.status === 404) {
      return {
        content: [{ type: "text" as const, text: missingSnapshotMessage(args.symbol, "cascade data") }],
        isError: true,
      };
    }
    if (!resp.ok) {
      return {
        content: [{ type: "text" as const, text: upstreamFailureText("simulate-depeg", resp) }],
        isError: true,
      };
    }
    const body = (await resp.json()) as Record<string, unknown>;
    Object.assign(body, freshness(body.updated_at, CASCADE_STALE_AFTER_SEC));
    return {
      content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
      structuredContent: body,
    };
  },
};
