// Free tool — per-asset peg-mechanism explanation.
//
// 2026-05-29: resolves AssetClass via REST API + 5min cache so the tool
// description ("returns the LST methodology", etc.) actually delivers.
// Before this, every call fell through to the "class unknown" fallback
// because the MCP server didn't load assets.toml — B-010 from the QA
// sweep. Going via the REST API avoids shipping the registry into the
// MCP runtime (smaller binary, one source of truth).

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { methodologyFor } from "@/shared/methodology";
import type { AssetClass } from "@/shared/types";

const METHODOLOGY_URL = "https://pegana.xyz/methodology";
const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";
const CLASS_CACHE_TTL_MS = 5 * 60 * 1000; // 5min

// Memoize symbol → class lookups. assets.toml changes infrequently; a
// stale entry just means we serve the previous methodology copy for
// up to 5min after a class rename, which is acceptable.
const classCache = new Map<string, { class: AssetClass | undefined; expiresAt: number }>();

async function resolveClass(symbol: string): Promise<AssetClass | undefined> {
  const cached = classCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return cached.class;

  try {
    const res = await fetch(`${API_BASE}/v1/assets/${encodeURIComponent(symbol)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      // Cache misses too — repeated lookups for an unknown symbol
      // shouldn't hammer the API.
      classCache.set(symbol, { class: undefined, expiresAt: Date.now() + CLASS_CACHE_TTL_MS });
      return undefined;
    }
    const body = (await res.json()) as { class?: string };
    const cls = body.class as AssetClass | undefined;
    classCache.set(symbol, { class: cls, expiresAt: Date.now() + CLASS_CACHE_TTL_MS });
    return cls;
  } catch {
    // Network blip — don't poison the cache. Next call retries.
    return undefined;
  }
}

export const getMethodologyTool = {
  name: "get_methodology",
  description:
    "Free. Explains *how* Pegana computes the peg/discount for a given asset — i.e. the formula behind `intrinsic_usd` " +
    "and what a non-zero `discount` means for that asset class (LST, fiat stablecoin, yield-bearing, CDP, synthetic, FX, RWA, delta-neutral). " +
    "Returns `structuredContent` shaped `{ symbol, explanation, methodology_url }` plus the same prose in `content[0].text`. " +
    "Example: `{ symbol: \"jitoSOL\" }` → returns the LST methodology (intrinsic = Sanctum stake-pool rate × Pyth SOL/USD; market = Jupiter quote). " +
    "Call this when an agent needs to *explain* a depeg, not just report it — e.g. to a user asking 'why is jitoSOL discounted?'.",
  inputSchema: {
    symbol: z
      .string()
      .min(1)
      .max(20)
      .describe(
        "Case-sensitive asset symbol (same set as `get_asset_state`). Methodology resolves to the asset's class, so e.g. any LST symbol returns the same LST explainer.",
      ),
  },
  outputSchema: {
    symbol: z.string().describe("The symbol the methodology was returned for."),
    explanation: z
      .string()
      .describe(
        "Prose paragraph describing how intrinsic_usd is computed for this asset class.",
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
  async handler(args: { symbol: string }) {
    const cls = await resolveClass(args.symbol);
    const text = methodologyFor(args.symbol, cls);
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
