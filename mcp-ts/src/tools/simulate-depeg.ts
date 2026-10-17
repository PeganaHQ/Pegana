// Free tool — Sub-C depeg-cascade simulator.
//
// Calls the api-rs `/v1/assets/{symbol}/simulate-depeg?shock_bps=` model (single
// Rust model). ADVISORY estimate, NOT a verifiable receipt (ADR-0036 inv.9).
// Anonymous + aggregate only; shock is restricted to a preset grid.

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";
const SHOCK_GRID = [100, 250, 500, 1000, 2000] as const;

export const simulateDepegTool = {
  name: "simulate_depeg_impact",
  description:
    "Free. Estimates the cross-protocol liquidation CASCADE if an asset depegs: `{ asset, shock_bps, loop_exposure_usd, liquidatable_usd, positions, coverage, by_protocol[], advisory_note }`. " +
    "`shock_bps` MUST be one of 100|250|500|1000|2000 (a preset grid — no continuous sweep). `liquidatable_usd` = leveraged collateral in bands that cross their liquidation threshold at that shock across Kamino + Jupiter Lend. " +
    "This is an ADVISORY model estimate, NOT a verifiable peg receipt; risky bands may be privacy-suppressed (coverage:partial), and slippage/bad-debt is not yet modelled. Anonymous + aggregate only (ADR-0036). Example: { symbol: \"hyUSD\", shock_bps: 500 }.",
  inputSchema: {
    symbol: z.string().min(1).max(20).describe("Case-sensitive asset symbol (run get_assets to enumerate)."),
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
    loop_exposure_usd: z.string(),
    liquidatable_usd: z.string(),
    positions: z.string(),
    coverage: z.string(),
    by_protocol: z.array(
      z.object({
        protocol: z.string(),
        liquidatable_usd: z.string(),
        positions: z.string(),
      }),
    ),
    advisory_note: z.string(),
    updated_at: z.string().optional(),
  },
  annotations: {
    title: "Simulate a depeg's liquidation cascade (advisory)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } satisfies ToolAnnotations,
  async handler(args: { symbol: string; shock_bps: number }) {
    const url = `${API_BASE}/v1/assets/${encodeURIComponent(args.symbol)}/simulate-depeg?shock_bps=${args.shock_bps}`;
    const resp = await fetch(url, { method: "GET" });
    if (resp.status === 404) {
      return {
        content: [{ type: "text" as const, text: `Error: asset '${args.symbol}' not tracked. Use get_assets() to list tracked symbols.` }],
        isError: true,
      };
    }
    if (!resp.ok) {
      return {
        content: [{ type: "text" as const, text: `Error: simulate-depeg failed (HTTP ${resp.status}).` }],
        isError: true,
      };
    }
    const body = (await resp.json()) as Record<string, unknown>;
    return {
      content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
      structuredContent: body,
    };
  },
};
