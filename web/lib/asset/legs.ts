// Helpers for the asset-detail "Legs" chart mode, which plots the two raw USD
// price legs (intrinsic/NAV vs market) so a user can distinguish a market
// crash from a NAV re-rating — the question the single zeroed spread line
// structurally cannot answer (the sHYUSD "PEGGED on −25% EWMA" failure class).

/**
 * Whether the Legs view is HONEST for an asset with the given peg target.
 *
 * `discount_snapshots` stores only USD legs, so the view is meaningful only
 * when the asset's peg target IS the US dollar. For any other target the USD
 * legs carry the (non-USD → USD) oracle multiplier and swing with it — an
 * LST's legs move with SOL/USD, EURC's with EUR/USD — while the real peg
 * (computed in the peg currency, where the multiplier cancels) is fine.
 * Plotting those legs would be misleading, so gate the view on `peg_target`.
 *
 * Allowlist semantics: only the exact string "USD" enables the view; an
 * unknown, empty, or missing target fails safe to false.
 */
export function legsAvailable(pegTarget: string | null | undefined): boolean {
  return pegTarget === "USD";
}

/**
 * Discount implied by the two USD legs, in bps, matching the engine sign
 * convention `discount = (intrinsic − market)/intrinsic`: a market BELOW NAV
 * reads as a positive (discount) value, ABOVE NAV as negative (premium) — the
 * same convention as the chart's primary series, so the legs-mode tooltip can
 * surface the gap the two near-identical lines encode. Returns null when the
 * intrinsic leg is non-positive or either input is not finite.
 */
export function impliedGapBps(
  market: number,
  intrinsic: number,
): number | null {
  if (
    !Number.isFinite(market) ||
    !Number.isFinite(intrinsic) ||
    intrinsic <= 0
  ) {
    return null;
  }
  return Math.round((1 - market / intrinsic) * 10000);
}

/**
 * Default tolerance for the "sources disagree" flag, in bps. Two independent
 * USD price sources (market = DEX, oracle = Pyth) shouldn't differ by more
 * than this; beyond it, one is stale/wrong or a real depeg one source hasn't
 * caught yet. Starting value borrowed from the intrinsic self-audit's 75bps
 * (INTRINSIC_DIVERGENCE_TOLERANCE_BPS) — DIFFERENT semantic (that one is
 * intrinsic-vs-intrinsic), same order of magnitude; tune independently.
 */
export const SOURCES_DISAGREE_TOLERANCE_BPS = 75;

export interface SourceLegs {
  /** NAV / redemption value (USD). */
  intrinsic?: number | null;
  /** DEX-traded price (USD). */
  market?: number | null;
  /** Pyth oracle price (USD). */
  oracle?: number | null;
}

export type SourcePair =
  "intrinsic-market" | "intrinsic-oracle" | "market-oracle";

export interface SourcesVerdict {
  /** True when the widest pairwise gap exceeds the tolerance. */
  disagree: boolean;
  /** Widest pairwise gap as bps of the reference; null if <2 legs present. */
  maxSpreadBps: number | null;
  /** The pair that produced `maxSpreadBps`; null if <2 legs present. */
  worstPair: SourcePair | null;
}

/**
 * Do the (up to 3) independent USD price sources agree within tolerance? This
 * is the core of the "sources disagree" signal: the widest pairwise gap among
 * the present legs (intrinsic NAV, DEX market, Pyth oracle), measured as bps of
 * the reference price (intrinsic when it's present & positive, else the mean of
 * the present legs), compared to `toleranceBps`.
 *
 * The **market↔oracle** pair is the load-bearing one — two structurally
 * independent price feeds; a wide gap there means one is stale/wrong or a real
 * depeg that only one source has priced in. Returns `disagree:false` with null
 * spread when fewer than two legs are available (nothing to compare) — fail
 * safe, never assert a divergence we can't measure.
 */
export function sourcesDisagree(
  legs: SourceLegs,
  toleranceBps: number = SOURCES_DISAGREE_TOLERANCE_BPS,
): SourcesVerdict {
  const present = (
    [
      ["intrinsic", legs.intrinsic],
      ["market", legs.market],
      ["oracle", legs.oracle],
    ] as [string, number | null | undefined][]
  )
    // `> 0`, not just finite: prices are USD and must be positive. A zeroed
    // or negative leg (e.g. a garbage/Unknown-status oracle print) would enter
    // as a numerator and fabricate a huge false spread — drop it, so a missing
    // leg fails safe rather than manufacturing a "sources disagree".
    .filter(
      (e): e is [string, number] =>
        typeof e[1] === "number" && Number.isFinite(e[1]) && e[1] > 0,
    );

  if (present.length < 2) {
    return { disagree: false, maxSpreadBps: null, worstPair: null };
  }

  const ref =
    typeof legs.intrinsic === "number" &&
    Number.isFinite(legs.intrinsic) &&
    legs.intrinsic > 0
      ? legs.intrinsic
      : present.reduce((sum, [, v]) => sum + v, 0) / present.length;

  if (!(ref > 0)) {
    return { disagree: false, maxSpreadBps: null, worstPair: null };
  }

  let maxSpreadBps = 0;
  let worstPair: SourcePair | null = null;
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const spread = Math.round(
        (Math.abs(present[i]![1] - present[j]![1]) / ref) * 10000,
      );
      if (spread > maxSpreadBps || worstPair === null) {
        maxSpreadBps = spread;
        // present[] preserves intrinsic<market<oracle order, so the joined
        // name always matches a SourcePair variant.
        worstPair = `${present[i]![0]}-${present[j]![0]}` as SourcePair;
      }
    }
  }

  return { disagree: maxSpreadBps > toleranceBps, maxSpreadBps, worstPair };
}
