// Free tool — Sub-C cross-protocol LEVERAGE exposure for one asset.
//
// Reads the api-rs `/v1/assets/{symbol}/loop-exposure` rollup (the single Rust
// model — no divergent logic here). ADVISORY model estimate, NOT a verifiable
// peg receipt (ADR-0036 inv.9). Anonymous, aggregate only.

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";

const byProtocol = z.object({
  protocol: z.string(),
  collateral_lev_usd: z.string().optional(),
  collateral_usd: z.string().optional(),
  debt_usd: z.string().optional(),
  positions: z
    .string()
    .optional()
    .describe("k-floored obligation-count RANGE (never a raw count)."),
  coverage: z.string(),
  ts: z.string().optional(),
});

export const getLoopExposureTool = {
  name: "get_loop_exposure",
  description:
    "Free. Cross-protocol LEVERAGE exposure to a single Solana asset (Kamino + Jupiter Lend): how much leveraged collateral and debt is stacked on it. " +
    "On success `structuredContent` = `{ asset, loop_exposure_usd, collateral_usd?, debt_usd, coverage, by_protocol[], updated_at?, advisory_note }` — USD values are decimal strings; `coverage` is `full|partial|unknown` and is `unknown` when there is no leverage data. " +
    "This is an ADVISORY model estimate, NOT a verifiable peg receipt, and is anonymous + aggregate only (no positions, no owners — ADR-0036). " +
    "Example: `{ symbol: \"vSOL\" }`. Returns `isError: true` if the symbol is not tracked (call `get_assets` first).",
  inputSchema: {
    symbol: z
      .string()
      .min(1)
      .max(20)
      .describe(
        "Case-sensitive asset symbol as published by Pegana (run `get_assets` to enumerate). Examples: `vSOL`, `JupSOL`, `jitoSOL`, `USDC`.",
      ),
  },
  outputSchema: {
    asset: z.string(),
    loop_exposure_usd: z.string(),
    collateral_usd: z.string().optional(),
    debt_usd: z.string(),
    coverage: z.string(),
    by_protocol: z.array(byProtocol),
    updated_at: z.string().optional(),
    advisory_note: z.string(),
  },
  annotations: {
    title: "Get cross-protocol leverage exposure for one asset (advisory)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } satisfies ToolAnnotations,
  async handler(args: { symbol: string }) {
    const url = `${API_BASE}/v1/assets/${encodeURIComponent(args.symbol)}/loop-exposure`;
    const resp = await fetch(url, { method: "GET" });
    if (resp.status === 404) {
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
    if (!resp.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: loop-exposure fetch failed (HTTP ${resp.status}).`,
          },
        ],
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
