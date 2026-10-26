// Free tool: lists every active, public tracked asset, like REST /v1/assets.
//
// Live values come from the Redis-warmed snapshot cache. An active asset
// with no complete live snapshot (the engine publishes no usable discount for
// it, e.g. a source is down) is still listed, as `state: "UNKNOWN"` with null
// values, exactly like REST does. R3 audit R3-MCP-04: those assets used to be
// dropped, so get_assets returned 57 rows while REST returned 67.
//
// Output is a structured `{ count, assets[] }` payload. The legacy
// `content[0].text` carries the same JSON for backwards-compatible
// clients that haven't migrated to structuredContent.

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { getAllCachedStates } from "@/redis";
import type { DiscountSnapshot } from "@/shared/types";
import { ASSET_REGISTRY, isNonPublicSymbol } from "@/shared/asset-registry";

const REGISTRY_SYMBOLS: ReadonlySet<string> = new Set(ASSET_REGISTRY.map((e) => e.symbol));
import {
  ageSeconds,
  FUTURE_TS_GRACE_SEC,
  isStaleAge,
  snapshotShape,
  STALE_AFTER_SEC,
} from "@/shared/snapshot-schema";

// Same keys as get_asset_state's snapshot; the value fields are nullable here
// because an active asset without a live snapshot is listed with nulls (as
// REST /v1/assets does) rather than hidden.
const assetSnapshot = z.object({
  asset: snapshotShape.asset,
  state: snapshotShape.state,
  discount: snapshotShape.discount
    .nullable()
    .describe(
      "1 - market/intrinsic as a decimal string (6 dp, like REST): negative = ABOVE intrinsic (a premium), positive = BELOW (a discount). E.g. `-0.0042` = 42bps above intrinsic (a premium). Null when the asset has no live snapshot (state `UNKNOWN`).",
    ),
  intrinsic_usd: snapshotShape.intrinsic_usd
    .nullable()
    .describe("Intrinsic value in USD, decimal string. Null when the asset has no live snapshot."),
  market_usd: snapshotShape.market_usd
    .nullable()
    .describe("Market price in USD, decimal string. Null when the asset has no live snapshot."),
  ts: snapshotShape.ts
    .nullable()
    .describe("Unix seconds at the snapshot timestamp. Null when the asset has no live snapshot."),
  updated_at: snapshotShape.updated_at
    .nullable()
    .describe(
      "Same instant as `ts`, ISO-8601 with milliseconds (UTC), as REST returns it. Null when the asset has no live snapshot.",
    ),
  stale: z
    .boolean()
    .describe(
      `True when the snapshot is older than ${STALE_AFTER_SEC}s, or stamped more than ${FUTURE_TS_GRACE_SEC}s in the future (an invalid timestamp), or there is no live snapshot at all. A stale entry reports \`state: "UNKNOWN"\`; its discount and prices are last-known, not live.`,
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
    "Free. Lists every asset currently tracked by Pegana with its real-time peg state, the same set as REST `/v1/assets`. " +
    "Returns `{ count, assets: [{ asset, state, discount, intrinsic_usd, market_usd, ts, updated_at, stale }, ...] }` " +
    "where `state` is one of `PEGGED | DRIFT | DEPEG | CRITICAL | BLACK_SWAN | UNKNOWN`, " +
    "`discount` = 1 − market/intrinsic, a signed decimal string: negative = ABOVE intrinsic (a premium), positive = BELOW (a discount), e.g. `-0.0042` = 42bps above intrinsic (a premium); `ts` is unix seconds, `updated_at` the same instant in ISO-8601; `stale` is true when the snapshot is older than 15 minutes or stamped more than 60 s in the future (a stale entry reports `state: \"UNKNOWN\"`). " +
    "An active asset with no live snapshot is still listed, with `state: \"UNKNOWN\"`, null `discount`, `intrinsic_usd`, `market_usd`, `ts` and `updated_at`, and `stale: true`, as REST lists it. " +
    "Call this once at session start to discover the supported symbols across LSTs, fiat stablecoins, " +
    "yield-bearing tokens, CDPs, FX-pegged, and delta-neutral synthetics. " +
    "Leveraged synthetics (class `synth_lev`, e.g. xSOL) are left out, exactly as in REST `/v1/assets`: they have no peg, so their market-vs-NAV gap is a leverage premium, not a peg deviation. Per-symbol tools report them as not tracked, as REST answers 404. " +
    "Use `get_asset_state` for a single symbol if you already know it; it returns just that snapshot.",
  inputSchema: {},
  outputSchema: {
    count: z
      .number()
      .int()
      .nonnegative()
      .describe(
        "Number of assets returned: every active tracked asset (with or without a live snapshot), leveraged synthetics excluded. Equals REST `/v1/assets` `count`.",
      ),
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
    const live = new Map(
      getAllCachedStates()
        .filter((snap) => !excludedFromList(snap.asset))
        .map((snap) => [snap.asset, snap]),
    );
    const listed = new Set<string>();
    const assets = [];
    // Registry order first: every active, public asset, live or not.
    for (const entry of ASSET_REGISTRY) {
      if (!entry.active || excludedFromList(entry.symbol)) continue;
      listed.add(entry.symbol);
      const snap = live.get(entry.symbol);
      assets.push(snap ? withStale(snap, now) : noSnapshot(entry.symbol));
    }
    // A live asset added after this build (not in the registry at all) still
    // shows. A registry row with `active = false` (BRZ, pbUSDC, ...) is NOT
    // appended even if a cached snapshot exists: REST lists active assets only.
    for (const [symbol, snap] of live) {
      if (!listed.has(symbol) && !REGISTRY_SYMBOLS.has(symbol)) {
        assets.push(withStale(snap, now));
      }
    }
    const structured = { count: assets.length, assets };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(structured, null, 2) },
      ],
      structuredContent: structured,
    };
  },
};

function withStale(snap: DiscountSnapshot, now: number) {
  const stale = isStaleAge(ageSeconds(snap.ts, now));
  // A stale snapshot is not served as a live verdict: state is UNKNOWN, like
  // get_asset_state and REST, with the last-known discount and prices kept.
  return stale ? { ...snap, state: "UNKNOWN" as const, stale } : { ...snap, stale };
}

function noSnapshot(symbol: string) {
  return {
    asset: symbol,
    state: "UNKNOWN" as const,
    discount: null,
    intrinsic_usd: null,
    market_usd: null,
    ts: null,
    updated_at: null,
    stale: true,
  };
}
