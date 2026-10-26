// Free tool — Sub-C cross-protocol LEVERAGE exposure for one asset.
//
// Reads the api-rs `/v1/assets/{symbol}/loop-exposure` rollup (the single Rust
// model — no divergent logic here). ADVISORY model estimate, NOT a verifiable
// peg receipt (ADR-0036 inv.9). Anonymous, aggregate only.

import { z } from "zod";
import { symbolSchema } from "@/shared/symbol";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { upstreamFailureText, upstreamGet } from "@/shared/upstream";
import { missingSnapshotMessage } from "@/shared/asset-registry";
import { freshness, freshnessShape } from "@/shared/snapshot-schema";

const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";
// The source refreshes every 5 minutes (protocol-indexer-ts); 3x/2x that is stale.
const LOOP_STALE_AFTER_SEC = 900;
// The HF bands behind `cascade[]` refresh hourly; same gate as simulate_depeg_impact.
const CASCADE_STALE_AFTER_SEC = 7200;
// Any grid point works: simulate-depeg's updated_at is max(band ts) regardless of shock.
const CASCADE_PROBE_SHOCK_BPS = 100;

/**
 * Band-only freshness for `cascade[]`. The loop-exposure `updated_at` is
 * max(exposure ts, band ts), so a 5-minute exposure rollup masks HF bands that
 * have been frozen for days (R1 audit idx 33). simulate-depeg derives its
 * `updated_at` from the bands alone, so read it from there. Returns `{}` (no
 * flag, nothing invented) when that call fails or carries no timestamp.
 */
async function cascadeFreshness(
  symbol: string,
  extra: unknown,
): Promise<{ cascade_stale?: boolean; cascade_data_age_sec?: number }> {
  try {
    const url = `${API_BASE}/v1/assets/${encodeURIComponent(symbol)}/simulate-depeg?shock_bps=${CASCADE_PROBE_SHOCK_BPS}`;
    const resp = await upstreamGet(url, extra);
    if (!resp.ok) return {};
    const sim = (await resp.json()) as Record<string, unknown>;
    const f = freshness(sim.updated_at, CASCADE_STALE_AFTER_SEC);
    if (f.stale === undefined) return {};
    return { cascade_stale: f.stale, cascade_data_age_sec: f.data_age_sec };
  } catch {
    return {};
  }
}

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
    "On success `structuredContent` = `{ asset, loop_exposure_usd, collateral_usd?, debt_usd, coverage, cascade_coverage?, by_protocol[], cascade?[], updated_at?, advisory_note }`. USD values are decimal strings; `coverage` is `partial|unknown` (the API never emits `full`: the bands are k-floored, so the picture is never complete) and is `unknown` when there is no leverage data; `cascade_coverage` is `partial` when fresh health-factor bands back `cascade[]` and `unknown` when they are missing or stale, in which case `cascade[]` is omitted and the liquidatable amount is NOT known (different from \"nothing liquidates\"); `stale: true` (with `data_age_sec`) means `updated_at` is older than 15 minutes; `updated_at` is the newest of the exposure rollup and the HF bands, so `stale` does NOT cover the cascade. " +
    "Cascade freshness is separate: `cascade_stale: true` (with `cascade_data_age_sec`) means the HF bands behind `cascade[]` are older than 2h (same gate as `simulate_depeg_impact.stale`); treat the cascade as last-known, not current. Both cascade fields are absent when band freshness could not be read. " +
    "This is an ADVISORY model estimate, NOT a verifiable peg receipt, and is anonymous + aggregate only (no positions, no owners; ADR-0036). " +
    "Example: `{ symbol: \"vSOL\" }`. Returns `isError: true` if the symbol is not tracked (call `get_assets` first).",
  inputSchema: {
    symbol: symbolSchema()
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
    cascade_coverage: z
      .enum(["partial", "unknown"])
      .optional()
      .describe(
        "Coverage of cascade[] only. `partial`: fresh health-factor bands exist (k-floored, so never complete). `unknown`: no fresh bands, cascade[] is omitted and the liquidatable amount is not known. Absent on older API builds.",
      ),
    by_protocol: z.array(byProtocol),
    cascade: z
      .array(
        z.object({
          shock_bps: z.number().int(),
          liquidatable_usd: z.string(),
          positions: z
            .string()
            .describe("k-floored obligation-count RANGE (never a raw count)."),
        }),
      )
      .optional()
      .describe(
        "Liquidation cascade on the preset shock grid (same model as `simulate_depeg_impact`).",
      ),
    updated_at: z.string().optional(),
    advisory_note: z.string(),
    ...freshnessShape(
      "every 5 minutes",
      LOOP_STALE_AFTER_SEC,
      "Covers the exposure rollup only: updated_at is the newest of the rollup and the HF bands, so a fresh rollup masks frozen bands. Use cascade_stale for cascade[].",
    ),
    cascade_updated_at: z
      .string()
      .optional()
      .describe("RFC 3339 timestamp of the oldest HF band behind cascade[]. Absent when the API does not report it."),
    cascade_stale: z
      .boolean()
      .optional()
      .describe(
        `True when the HF bands behind cascade[] are more than ${CASCADE_STALE_AFTER_SEC}s old (they refresh hourly): the cascade is last-known, not current. Independent of \`stale\`, which updated_at drives and a fresh exposure rollup can mask. Absent when band freshness is unavailable.`,
      ),
    cascade_data_age_sec: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Seconds since the newest HF band behind cascade[] was written."),
  },
  annotations: {
    title: "Get cross-protocol leverage exposure for one asset (advisory)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } satisfies ToolAnnotations,
  async handler(args: { symbol: string }, extra?: unknown) {
    const url = `${API_BASE}/v1/assets/${encodeURIComponent(args.symbol)}/loop-exposure`;
    const resp = await upstreamGet(url, extra);
    if (resp.status === 404) {
      return {
        content: [
          {
            type: "text" as const,
            text: missingSnapshotMessage(args.symbol, "loop-exposure data"),
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
            text: upstreamFailureText("loop-exposure fetch", resp),
          },
        ],
        isError: true,
      };
    }
    const body = (await resp.json()) as Record<string, unknown>;
    body.advisory_note = `${typeof body.advisory_note === "string" ? body.advisory_note : ""} Privacy suppression omits HF bands with fewer than five positions or one position above 45% of collateral; concentrated liquidation risk can therefore be understated.`.trim();
    Object.assign(body, freshness(body.updated_at, LOOP_STALE_AFTER_SEC));
    if (Array.isArray(body.cascade) && body.cascade.length > 0) {
      // api-rs now returns the oldest band ts as `cascade_updated_at`; use it
      // directly and fall back to the simulate-depeg probe for older servers.
      const own =
        typeof body.cascade_updated_at === "string"
          ? freshness(body.cascade_updated_at, CASCADE_STALE_AFTER_SEC)
          : undefined;
      if (own && own.stale !== undefined) {
        Object.assign(body, { cascade_stale: own.stale, cascade_data_age_sec: own.data_age_sec });
      } else {
        Object.assign(body, await cascadeFreshness(args.symbol, extra));
      }
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
      structuredContent: body,
    };
  },
};
