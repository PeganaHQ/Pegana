// Free tool — per-asset peg-mechanism explanation.
//
// Resolution order:
//   1. The generated registry (@/shared/asset-registry, from assets.toml):
//      class AND the asset's real intrinsic/market sources, no network.
//   2. Only for a symbol the registry does not know (an asset added after
//      this build): its class via REST GET /v1/assets/{symbol}, cached.
//
// R1 audit idx 86: the REST fallback used to cache EVERY non-2xx for 5 min,
// so one upstream 429 (the public API is rate-limited per IP) served the
// "class unknown" fallback for valid assets for 5 minutes. Now only a 404
// (definitively unknown) is cached; 429/5xx/network errors are not.

import { z } from "zod";
import { symbolSchema } from "@/shared/symbol";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { upstreamGet } from "@/shared/upstream";
import { methodologyFor } from "@/shared/methodology";
import { missingSnapshotMessage, registryEntry } from "@/shared/asset-registry";
import type { AssetClass } from "@/shared/types";

const METHODOLOGY_URL = "https://pegana.xyz/methodology";
const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";
const CLASS_CACHE_TTL_MS = 5 * 60 * 1000; // 5min

// Memoize symbol → class lookups. assets.toml changes infrequently; a
// stale entry just means we serve the previous methodology copy for
// up to 5min after a class rename, which is acceptable.
const classCache = new Map<string, { class: AssetClass | undefined; expiresAt: number }>();

/**
 * REST class lookup for a symbol the registry lacks:
 *   * `{ found: true, class }` (class may be undefined if REST omits it),
 *   * `{ found: false }` on a 404: definitively not tracked (cached),
 *   * `{ unavailable: status }` on 429 / 5xx / network error: transient,
 *     never cached, or a valid asset reads as unknown until the TTL expires.
 */
type ClassLookup =
  | { found: true; class: AssetClass | undefined }
  | { found: false }
  | { unavailable: number | "network" };

async function resolveClass(symbol: string, extra?: unknown): Promise<ClassLookup> {
  const cached = classCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.class === undefined ? { found: false } : { found: true, class: cached.class };
  }

  try {
    const res = await upstreamGet(
      `${API_BASE}/v1/assets/${encodeURIComponent(symbol)}`,
      extra,
    );
    if (res.status === 404) {
      // Definitively unknown: cache the miss so repeated lookups for a
      // bogus symbol don't hammer the API.
      classCache.set(symbol, { class: undefined, expiresAt: Date.now() + CLASS_CACHE_TTL_MS });
      return { found: false };
    }
    if (!res.ok) return { unavailable: res.status };
    const body = (await res.json()) as { class?: string };
    const cls = body.class as AssetClass | undefined;
    if (cls !== undefined) {
      classCache.set(symbol, { class: cls, expiresAt: Date.now() + CLASS_CACHE_TTL_MS });
    }
    return { found: true, class: cls };
  } catch {
    // Network blip: don't poison the cache. Next call retries.
    return { unavailable: "network" };
  }
}

export const getMethodologyTool = {
  name: "get_methodology",
  description:
    "Free. Explains *how* Pegana computes the peg/discount for a given asset, i.e. the formula behind `intrinsic_usd` " +
    "and what a non-zero `discount` means for that asset class (LST, fiat stablecoin, yield-bearing, CDP, synthetic, FX, RWA, delta-neutral). " +
    "Returns `structuredContent` shaped `{ symbol, explanation, methodology_url }` plus the same prose in `content[0].text`. " +
    "The explanation names the asset's actual intrinsic and market sources (from Pegana's asset registry), not a generic per-class summary. " +
    "Example: `{ symbol: \"jitoSOL\" }` returns the LST methodology with jitoSOL's sources (intrinsic = SPL stake-pool rate × Pyth SOL/USD; market = Jupiter quote vs SOL × Pyth SOL/USD). " +
    "Call this when an agent needs to *explain* a depeg, not just report it, e.g. to a user asking 'why is jitoSOL discounted?'. " +
    "Returns `isError: true` if the symbol is not tracked (call `get_assets` first) or the lookup is temporarily unavailable.",
  inputSchema: {
    symbol: symbolSchema()
      .describe(
        "Case-sensitive asset symbol (same set as `get_asset_state`).",
      ),
  },
  outputSchema: {
    symbol: z.string().describe("The symbol the methodology was returned for."),
    explanation: z
      .string()
      .describe(
        "Prose describing the asset class, how this asset's intrinsic_usd and market_usd are sourced, and how the discount and state are computed.",
      ),
    methodology_url: z
      .string()
      .url()
      .describe("Canonical URL of the full Pegana methodology page."),
  },
  annotations: {
    title: "Get peg-mechanism explanation",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } satisfies ToolAnnotations,
  async handler(args: { symbol: string }, extra?: unknown) {
    const entry = registryEntry(args.symbol);
    let cls: AssetClass | undefined = entry?.class;
    if (!entry) {
      const lookup = await resolveClass(args.symbol, extra);
      // Same contract as the other per-symbol tools (R2 audit idx 23a): an
      // unknown symbol is an error, not a successful "class unknown" answer.
      if ("unavailable" in lookup) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: could not look up asset '${args.symbol}' right now (${lookup.unavailable === "network" ? "upstream unreachable" : `upstream HTTP ${lookup.unavailable}`}). Retry later.`,
            },
          ],
          isError: true as const,
        };
      }
      if (!lookup.found) {
        return {
          content: [{ type: "text" as const, text: missingSnapshotMessage(args.symbol, "methodology") }],
          isError: true as const,
        };
      }
      cls = lookup.class;
    }
    const text = methodologyFor(args.symbol, cls, entry);
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: {
        symbol: args.symbol,
        explanation: text,
        methodology_url: METHODOLOGY_URL,
      },
    };
  },
};

// Exported for tests — lets us reset the cache between cases.
export const __test = { classCache, resolveClass };
