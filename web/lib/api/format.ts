import { formatCompactUsd } from "@/lib/lst/format";

export function discountToBps(d: string | null): number | null {
  if (d == null) return null;
  const n = parseFloat(d);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 10000);
}

/**
 * Maximum plausible |discount| for any tracked asset. 100% means market is
 * either 0× or 2× the intrinsic — already impossible for stables, LSTs and
 * leveraged synths Pegana tracks. Anything beyond this is upstream garbage
 * (stale oracle, empty Jupiter route, NAV calculation edge case) that
 * shouldn't be propagated into UI or rolling averages.
 */
export const MAX_PLAUSIBLE_ABS_DISCOUNT = 1.0;

export interface ReconciledSpread {
  /** Trusted bps to display. Either the server's value (when sane) or the
   *  fresh computation from intrinsic/market (when the server's value is
   *  contaminated by EWMA smoothing of an upstream anomaly). */
  bps: number | null;
  /** True when the server-declared discount disagrees materially with the
   *  raw prices it ships alongside, OR when either value is physically
   *  impossible. Surface a recovery banner in the UI when true. */
  suspect: boolean;
  /** Same numbers, raw — useful for tooltips / debugging. */
  declared_bps: number | null;
  computed_bps: number | null;
}

/**
 * Drift threshold (bps). Declared-vs-computed mismatch under this is normal
 * EWMA-smoothing lag (real prices moved a step, smoothing hasn't caught up).
 * Above it means the smoothed value is carrying a corrupted upstream sample.
 *
 * 200 bps = 2% drift. Comfortably above legitimate smoothing lag for a step
 * move of ~300 bps (α=0.3 → first-bucket lag ≈ 210 bps), so a real fast
 * depeg starting won't trigger the recovery banner. Tight enough that the
 * decay tail from a corrupted sample (typically 1000+ bps drift for 5+
 * buckets) always trips it.
 */
const SUSPECT_DRIFT_BPS = 200;

/**
 * Cross-check the API's `discount` field against a fresh computation from
 * `intrinsic_usd` / `market_usd`. The backend's smoothing pipeline can carry
 * a corrupted sample for several minutes (EWMA(α=0.3) → ~7 buckets to
 * decay), during which `discount` lies but the raw prices it ships in the
 * same payload are still trustworthy. Picking the raw prices in that window
 * keeps the UI honest.
 */
export function reconcileBps(asset: {
  discount: string | null;
  intrinsic_usd: string | null;
  market_usd: string | null;
}): ReconciledSpread {
  const declared_bps = discountToBps(asset.discount);

  // Compute fresh from the two raw prices when both are present.
  let computed_bps: number | null = null;
  if (asset.intrinsic_usd != null && asset.market_usd != null) {
    const intr = parseFloat(asset.intrinsic_usd);
    const mkt = parseFloat(asset.market_usd);
    if (Number.isFinite(intr) && Number.isFinite(mkt) && intr !== 0) {
      computed_bps = Math.round(((intr - mkt) / intr) * 10000);
    }
  }

  const MAX_BPS = MAX_PLAUSIBLE_ABS_DISCOUNT * 10000;
  const declaredImpossible =
    declared_bps != null && Math.abs(declared_bps) > MAX_BPS;
  const computedImpossible =
    computed_bps != null && Math.abs(computed_bps) > MAX_BPS;

  // No computed value (no raw prices to verify against). Trust declared
  // unless it's physically nonsense.
  if (computed_bps == null || computedImpossible) {
    if (declaredImpossible) {
      return { bps: null, suspect: true, declared_bps, computed_bps };
    }
    return { bps: declared_bps, suspect: false, declared_bps, computed_bps };
  }

  // Have a plausible computed value — declared can be reconciled.
  if (declared_bps == null) {
    return { bps: computed_bps, suspect: false, declared_bps, computed_bps };
  }
  if (declaredImpossible) {
    return { bps: computed_bps, suspect: true, declared_bps, computed_bps };
  }

  const drift = Math.abs(declared_bps - computed_bps);
  if (drift > SUSPECT_DRIFT_BPS) {
    return { bps: computed_bps, suspect: true, declared_bps, computed_bps };
  }
  return { bps: declared_bps, suspect: false, declared_bps, computed_bps };
}

/**
 * Drop physically-impossible samples from a discount series (0-1 decimal
 * range; `series_24h` and friends). Values outside ±MAX_PLAUSIBLE_ABS_DISCOUNT
 * are upstream artefacts that destroy chart Y-axes when plotted.
 */
export function cleanSeries(
  series: number[] | undefined | null,
  maxAbs: number = MAX_PLAUSIBLE_ABS_DISCOUNT,
): number[] {
  if (!series || series.length === 0) return [];
  return series.filter((v) => Number.isFinite(v) && Math.abs(v) <= maxAbs);
}

/**
 * Same filter, but for bps values (i.e. the `discount * 10000` form used by
 * chart components). Convenience to avoid sprinkling unit conversions.
 */
export function cleanBpsSeries(
  series: number[] | undefined | null,
  maxAbsBps: number = MAX_PLAUSIBLE_ABS_DISCOUNT * 10000,
): number[] {
  if (!series || series.length === 0) return [];
  return series.filter((v) => Number.isFinite(v) && Math.abs(v) <= maxAbsBps);
}

/**
 * Peg-stability / jitter signal: the population standard deviation of a 24h
 * discount series (`series_24h`), expressed in **bps** (the series ships as
 * fractional discounts, so ×10000). Two assets can print the same *instantaneous*
 * spread yet behave totally differently — a steady −0.30% and a whipsawing
 * ±0.30% read identically in the spread column but have very different dispersion.
 * Surfacing this turns the product from a lagging state-reporter into a leading
 * indicator (rising spread *volatility* precedes a depeg).
 *
 * Outliers are dropped first (reuse `cleanSeries`) so a single upstream-garbage
 * print doesn't dominate. Needs ≥2 samples to mean anything → returns null below
 * that so callers can render "—" instead of a fake 0.
 */
export function pegJitter(series: number[] | null | undefined): number | null {
  const clean = cleanSeries(series);
  if (clean.length < 2) return null;
  const bps = clean.map((v) => v * 10000);
  const mean = bps.reduce((a, b) => a + b, 0) / bps.length;
  const variance =
    bps.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / bps.length;
  return Math.sqrt(variance);
}

/**
 * Parse a backend non-negative dispersion field — `jitter_bps_24h` (24h
 * peak-to-trough RANGE) or `worst_abs_24h` (worst absolute excursion) — from its
 * rust_decimal signed-fraction string into **bps** (×10000). These are computed
 * server-side over MINUTE-level `discount_1m` extremes, so they're strictly more
 * precise than any range re-derived client-side from the hourly-AVERAGED
 * `series_24h` (averaging first smooths away intra-hour spikes — the exact
 * tail-risk a peg-risk surface must NOT hide). Returns null when absent, NaN, or
 * outside the plausible band (a range spans at most 2×MAX_PLAUSIBLE_ABS_DISCOUNT),
 * so callers fall back to the coarser series or render "—", never a fake value.
 */
export function dispersionBps(
  fractionStr: string | null | undefined,
): number | null {
  if (fractionStr == null) return null;
  const bps = Number(fractionStr) * 10000;
  const maxBps = MAX_PLAUSIBLE_ABS_DISCOUNT * 10000 * 2;
  if (!Number.isFinite(bps) || bps < 0 || bps > maxBps) return null;
  return bps;
}

export type JitterBucket = "steady" | "choppy" | "volatile" | "unknown";

/**
 * Coarse stability bucket for a `pegJitter` value (bps). Calibrated against the
 * live universe (calm-market dispersion sits ~0.8–2.7 bps); the label earns its
 * keep under stress, while the raw number carries the fine-grained signal in a
 * sortable column. Thresholds documented so they can move once we have incident
 * data to calibrate against.
 */
const JITTER_STEADY_MAX_BPS = 5;
const JITTER_CHOPPY_MAX_BPS = 20;
export function jitterLabel(
  jitterBps: number | null | undefined,
): JitterBucket {
  if (jitterBps == null || !Number.isFinite(jitterBps)) return "unknown";
  if (jitterBps < JITTER_STEADY_MAX_BPS) return "steady";
  if (jitterBps < JITTER_CHOPPY_MAX_BPS) return "choppy";
  return "volatile";
}

/**
 * 24h peg-stability dispersion as a FRIENDLY ± percentage (bps ÷ 100) instead
 * of raw basis points — e.g. 889.4 bps → "±8.89%", a steady 3.2 bps → "±0.03%"
 * (honestly near-flat). "bps" is jargon; "%" isn't. Used everywhere the
 * Stability value is shown (dashboard board, screener, Most-volatile card).
 */
export function formatJitterPct(jitterBps: number | null | undefined): string {
  if (jitterBps == null || !Number.isFinite(jitterBps)) return "-";
  return `±${(jitterBps / 100).toFixed(2)}%`;
}

/**
 * Band-proximity distance as a FRIENDLY percentage — how far the current spread
 * sits from its depeg threshold, e.g. 38 bps → "0.38%", 0 → "0.00%". No sign
 * (it's a distance, always ≥0). Replaces the raw "N bps away" jargon on the
 * dashboard's "Closest to its band" card + verdict line.
 */
export function formatBandAwayPct(bpsAway: number | null | undefined): string {
  if (bpsAway == null || !Number.isFinite(bpsAway)) return "-";
  return `${Math.max(0, bpsAway / 100).toFixed(2)}%`;
}

/**
 * Predicate: is this single discount sample sane? Use to filter history
 * points before plotting.
 */
export function isPlausibleDiscount(
  d: string | number | null | undefined,
): boolean {
  if (d == null) return false;
  const n = typeof d === "string" ? parseFloat(d) : d;
  if (!Number.isFinite(n)) return false;
  return Math.abs(n) <= MAX_PLAUSIBLE_ABS_DISCOUNT;
}

// Assets whose secondary market is thin enough that a large gap doesn't reflect
// what a trader would actually realise. Frontend uses this to soften the visual
// signal (muted color, "thin liquidity" tag) until a per-asset API field lands.
// Kept here rather than in types.ts so the list stays close to the formatters
// that consume it.
const LOW_LIQUIDITY_SYMBOLS: ReadonlySet<string> = new Set(["BRZ"]);
export function isLowLiquidity(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return LOW_LIQUIDITY_SYMBOLS.has(symbol);
}

// Deprecated assets — kept in the universe for historical continuity but
// excluded from any aggregation that would let them poison the signal (peer
// comparison, sector medians, etc.). dSOL: Drift exploited 2026-04-01.
const DEPRECATED_SYMBOLS: ReadonlySet<string> = new Set(["dSOL"]);
export function isDeprecated(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  return DEPRECATED_SYMBOLS.has(symbol);
}

// Per-asset glyph + label for the safety dimension surfaced on the asset detail.
// Order matters: we use the count of green dots as the safety score in `safetyGrade`.
export type SafetyDim = "peg" | "liquidity" | "mechanism";

/**
 * The pre-0075 liquidity heuristic, retained ONLY as the fallback for assets
 * with no fresh `market_depth`. Known to be wrong on ordering (see
 * `safetyGrade`'s doc comment); never use it when real data is available.
 */
const LEGACY_DEEP_SYMBOLS: ReadonlySet<string> = new Set([
  "USDC",
  "USDT",
  "jitoSOL",
  "mSOL",
  "JupSOL",
]);
function legacyLiquidityDots(symbol: string): 1 | 2 | 3 {
  if (LOW_LIQUIDITY_SYMBOLS.has(symbol)) return 1;
  return LEGACY_DEEP_SYMBOLS.has(symbol) ? 3 : 2;
}
export interface SafetyScore {
  peg: 1 | 2 | 3; // historical peg adherence
  liquidity: 1 | 2 | 3; // secondary market depth (proxy: known thin list + LST/stable bias)
  mechanism: 1 | 2 | 3; // simplicity of the redemption mechanism
}

/**
 * The subset of an asset this module needs. Structural, so `AssetCardData`
 * satisfies it directly and callers can pass the asset they already hold.
 */
export interface SafetyInput {
  symbol: string;
  class: string;
  /** Server-computed market depth (migration 0075 + `market_score.rs`). */
  market_depth?: {
    score: number | null;
    caps: string[];
    insufficient_reason?: string | null;
  } | null;
  /** When the market context behind `market_depth` was observed. */
  market_context_at?: string | null;
}

/**
 * The liquidity dimension is only trusted while the underlying observation is
 * recent. This is DELIBERATELY not `STALE_AFTER_MS` (15 min) from
 * `lib/asset/freshness.ts`: that constant is tuned to the live discount
 * pipeline, whereas market context is polled every ~30 min by design. Six hours
 * is ~12 poll cycles — long enough to ride out a transient upstream outage,
 * short enough that a genuinely dead feed stops driving a visible grade.
 */
export const MARKET_DEPTH_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** Whether `market_depth` is fresh enough to drive the liquidity dimension. */
export function isMarketDepthUsable(
  asset: SafetyInput,
  now: number = Date.now(),
): boolean {
  if (asset.market_depth?.score == null) return false;
  if (!asset.market_context_at) return false;
  const observedAt = Date.parse(asset.market_context_at);
  if (Number.isNaN(observedAt)) return false;
  return now - observedAt <= MARKET_DEPTH_STALE_AFTER_MS;
}

/** Map a 0-100 market-depth score onto the three-dot dimension scale. */
function liquidityDotsFromDepth(score: number): 1 | 2 | 3 {
  if (score >= 67) return 3;
  if (score >= 34) return 2;
  return 1;
}

/**
 * Safety scoring for the asset detail page.
 *
 * The `liquidity` dimension is REAL: it comes from `market_depth`, derived
 * server-side from tokens.xyz-sourced liquidity / 24h volume / holder count
 * (migration 0075). `peg` and `mechanism` remain class-based heuristics — no
 * data source feeds them yet, and the UI label must not imply otherwise.
 *
 * When `market_depth` is absent or stale, the liquidity dimension falls back to
 * the original hardcoded heuristic. That fallback is kept deliberately rather
 * than deleted, so an asset tokens.xyz does not cover (7 of 69 as of
 * 2026-08-10) still shows something defensible instead of a blank.
 *
 * The old heuristic was not merely coarse, it was WRONG: it hardcoded mSOL and
 * JupSOL as top-tier "deep" while bbSOL, BNSOL, dzSOL and PSOL fell into the
 * generic bucket — yet measured DEX liquidity is $5.6M and $1.6M for the former
 * against $96M-$787M for the latter. Real data inverts that ordering.
 */
export function safetyGrade(
  asset: SafetyInput,
  now: number = Date.now(),
): SafetyScore {
  const { symbol, class: klass } = asset;
  // Peg: fiat-backed stables and yield are very predictable; CDP/synth have known tail risk.
  const peg: 1 | 2 | 3 =
    klass === "stable_fiat" || klass === "stable_yield"
      ? 3
      : klass === "lst"
        ? 3
        : klass === "stable_cdp" || klass === "stable_dn"
          ? 2
          : klass === "stable_fx"
            ? 2
            : klass === "synth_lev"
              ? 1
              : 2;
  // Liquidity: real when the server has fresh market depth; otherwise the
  // legacy symbol heuristic as an explicit, labelled fallback.
  const liquidity: 1 | 2 | 3 = isMarketDepthUsable(asset, now)
    ? liquidityDotsFromDepth(asset.market_depth!.score!)
    : legacyLiquidityDots(symbol);
  // Mechanism: simplest first. Fiat-backed = direct. LST = pool. CDP/synth = layered.
  const mechanism: 1 | 2 | 3 =
    klass === "stable_fiat"
      ? 3
      : klass === "lst"
        ? 3
        : klass === "stable_fx"
          ? 2
          : klass === "stable_yield"
            ? 2
            : klass === "stable_cdp" || klass === "stable_dn"
              ? 2
              : klass === "synth_lev"
                ? 1
                : 2;
  return { peg, liquidity, mechanism };
}

export function safetyTotalGrade(s: SafetyScore): "A" | "B" | "C" | "D" {
  const sum = s.peg + s.liquidity + s.mechanism;
  if (sum >= 8) return "A";
  if (sum >= 6) return "B";
  if (sum >= 4) return "C";
  return "D";
}

/**
 * Human-readable rationale per dimension so the SafetyGrade molecule doesn't
 * read as an opaque badge. Kept symbol/class-aware so the explanation matches
 * what scored the dimension where it did.
 */
export function safetyRationale(
  asset: SafetyInput,
  now: number = Date.now(),
): Record<SafetyDim, string> {
  const { symbol, class: klass } = asset;
  const score = safetyGrade(asset, now);
  const thin = LOW_LIQUIDITY_SYMBOLS;

  const pegRationale =
    klass === "stable_fiat" || klass === "stable_yield"
      ? "Fiat-backed reserves with attestation history. Off-peg events historically resolve within hours."
      : klass === "lst"
        ? "Stake-pool LST. Intrinsic is on-chain ground truth; secondary market typically tracks within ~0.10%."
        : klass === "stable_cdp" || klass === "stable_dn"
          ? "Mechanism stability is the dominant risk. Past depegs in this class lasted minutes-to-hours."
          : klass === "stable_fx"
            ? "FX peg subject to fiat liquidity, not just on-chain. Thresholds widened to absorb normal currency drift."
            : klass === "synth_lev"
              ? "Leveraged synthetic, peg can move sharply with collateral price action. Treat as a directional bet, not a stable."
              : "Heuristic baseline applied.";

  // Real-data path: explain the actual measurement, and surface the exact
  // constraint that bounded it when one fired. A grade that says why is a
  // grade a holder can act on.
  const liquidityRationale = isMarketDepthUsable(asset, now)
    ? (() => {
        const caps = asset.market_depth?.caps ?? [];
        if (caps.length > 0) {
          return `Measured market depth is bounded by ${caps.join(" and ")}. Size your exit against that, not against the quoted spread.`;
        }
        return score.liquidity === 3
          ? "Measured depth, 24h volume and holder spread all read healthy. Realised slippage tracks the quoted spread closely at retail size."
          : score.liquidity === 2
            ? "Measured depth is workable but not deep. Retail round-trips are fine; institutional size needs its own quote."
            : "Measured depth is weak. Large quotes face material slippage that Pegana's spread does not model.";
      })()
    : thin.has(symbol)
      ? "Thin secondary market. Large quotes face material slippage Pegana doesn't model. (No fresh depth measurement, class heuristic.)"
      : LEGACY_DEEP_SYMBOLS.has(symbol)
        ? "Deep secondary market across multiple Solana DEXes. (No fresh depth measurement, class heuristic.)"
        : "Acceptable secondary depth assumed. (No fresh depth measurement, class heuristic.)";

  const mechanismRationale =
    klass === "stable_fiat"
      ? "Direct fiat redemption. Lowest mechanism risk."
      : klass === "lst"
        ? "Stake-pool redemption (instant unstake fee or epoch wait). Mechanism risk dominated by validator + slashing."
        : klass === "stable_cdp" || klass === "stable_dn"
          ? "Layered redemption (collateral → vault → token). Mechanism risk includes program upgrades and oracle dependencies."
          : klass === "synth_lev"
            ? "Leveraged synthetic mechanism with negative-tail risk under stress. Read the protocol docs before sizing."
            : klass === "stable_yield"
              ? "Yield-bearing stable backed by an on-chain pool. Redemption depends on pool solvency."
              : klass === "stable_fx"
                ? "FX peg via oracle cross. Mechanism depends on oracle integrity + sufficient on-chain liquidity to absorb arb."
                : "Heuristic mechanism baseline.";

  // The "current score" is implicit — the rationale stays the same regardless
  // of the integer 1/2/3, because the rationale describes the *category* of
  // mechanism, not its instantaneous quality.
  void score;
  return {
    peg: pegRationale,
    liquidity: liquidityRationale,
    mechanism: mechanismRationale,
  };
}

export function formatBps(bps: number): string {
  if (bps === 0) return "0 bps";
  const sign = bps > 0 ? "+" : "−";
  return `${sign}${Math.abs(bps)} bps`;
}

/**
 * Spread display in % across all magnitudes, with adaptive decimals so the
 * column stays scannable from −0.01% LST drift to −74% liquidity-stress
 * mispricing. Single unit avoids the "is 63 bps bigger than 1.08%" cognitive
 * tax that mixed-unit columns create.
 *
 *   ±0 → "0.00%"
 *   |bps| < 1000 (<10%)  → "±N.NN%"  (LST drift + depeg territory)
 *   |bps| < 10000 (<100%) → "±N.N%"  (visible mispricing)
 *   ≥10000 (≥100%)       → "±N%"    (pathological / thin-liquidity quotes)
 */
export function formatGap(bps: number | null | undefined): string {
  if (bps == null) return "-";
  if (bps === 0) return "0.00%";
  const sign = bps > 0 ? "+" : "−";
  const abs = Math.abs(bps);
  const pct = abs / 100;
  if (abs < 1000) return `${sign}${pct.toFixed(2)}%`;
  if (abs < 10000) return `${sign}${pct.toFixed(1)}%`;
  return `${sign}${Math.round(pct)}%`;
}

/**
 * Spread as a **holder-signed** percentage: `+` = PREMIUM (market ABOVE
 * intrinsic/backing), `−` = DISCOUNT (market BELOW). This is the site's one true
 * display convention (see `web/lib/glossary.ts` + the `compare/share` route).
 *
 * The catch: the API `discount` field — and therefore `discountToBps()` and
 * `reconcileBps().bps` — follow the RAW methodology sign (`discount = 1 −
 * market/intrinsic`), where a premium is NEGATIVE and a discount is POSITIVE —
 * the inverse of what a holder reads. `formatGap()` prints that raw sign as-is,
 * so any surface that fed it `reconcileBps().bps` directly printed the sign
 * BACKWARDS (the 2026-07-23 QA audit found ~11 such surfaces — badges, the
 * audit receipt page, the chart "now:", ⌘K, share cards, MCP-adjacent).
 *
 * Route EVERY spread display through this helper so the flip happens exactly
 * once and can never drift per-call-site again. Pass the RAW reconciled bps;
 * this negates before formatting. (Sites that already hand-flip — e.g. the hero
 * `fmtSpread` — are equivalent; prefer this to keep one source of truth.)
 */
export function holderSignedPct(rawBps: number | null | undefined): string {
  if (rawBps == null) return formatGap(rawBps);
  // Negate the raw methodology sign into the holder convention, then reuse
  // formatGap's magnitude-adaptive precision. `-0` formats as "0.00%" (no sign).
  return formatGap(rawBps === 0 ? 0 : -rawBps);
}

/**
 * Tailwind text color for a spread NUMBER, driven by its own displayed sign:
 * premium (holder `+`) is green, discount (holder `−`) is red, zero is neutral.
 *
 * Pass the SAME raw, `reconcileBps`-convention bps that already feeds this
 * value's text through `holderSignedPct()` / `formatGap(-bps)`. This negates
 * internally, so the printed sign and the color are derived from one input by
 * one code path and cannot drift apart. Computing the color from a separately
 * hand-negated variable is exactly how the 2026-07-23 audit ended up with ~11
 * surfaces printing the sign backwards — do not reintroduce that shape.
 *
 * NOT for state-bound values. A verdict sentence or a 0-100 risk score has no
 * sign of its own; those use `severityTextClass(state)` from lib/state-class.ts.
 */
export function spreadSignClass(rawBps: number | null | undefined): string {
  if (rawBps == null || !Number.isFinite(rawBps) || rawBps === 0) {
    return "text-text";
  }
  // holder-signed = -rawBps, so a POSITIVE raw bps is a holder discount.
  return rawBps > 0 ? "text-st-depeg-text" : "text-st-pegged";
}

/**
 * Same rule as {@link spreadSignClass}, as a `var(...)` string for consumers
 * that set an inline style rather than a class (SVG fills, canvas, heatmap
 * cells). Mirrors the shape of `StateMeta.dotVar`.
 */
export function spreadSignVar(rawBps: number | null | undefined): string {
  if (rawBps == null || !Number.isFinite(rawBps) || rawBps === 0) {
    return "var(--color-text)";
  }
  return rawBps > 0 ? "var(--color-st-depeg-text)" : "var(--color-st-pegged)";
}

export function formatUsd(value: string | null, decimals = 2): string {
  if (value == null) return "-";
  const n = parseFloat(value);
  if (Number.isNaN(n)) return "-";
  return `$${n.toFixed(decimals)}`;
}

/**
 * Render a `market_usd` / `intrinsic_usd` API field. These are ALWAYS USD,
 * regardless of the asset's `peg_target` — an LST like jitoSOL ships
 * `market_usd: "100.99"` (~$101 / ~1.04 SOL). Earlier call sites appended the
 * peg_target unit, printing "100.99 SOL" (~100× wrong). Prefix "$" and reuse
 * `formatValue`'s magnitude-adaptive precision so sub-dollar synths/stables
 * keep their fractional digits instead of collapsing to "$0.05".
 */
export function formatUsdValue(value: string | null, decimals = 4): string {
  const s = formatValue(value, decimals);
  return s === "-" ? "-" : `$${s}`;
}

/**
 * Compact display of a raw API number (intrinsic/market values) — the API
 * returns rust_decimal::Decimal serialized as a long string like
 * "123.211128217603617210". We render at most `decimals` fractional digits
 * to keep rows readable on mobile.
 */
export function formatValue(value: string | null, decimals = 4): string {
  if (value == null) return "-";
  const n = parseFloat(value);
  if (Number.isNaN(n)) return "-";
  // Pick precision based on magnitude: large values get fewer decimals.
  const abs = Math.abs(n);
  const p =
    abs >= 100
      ? Math.min(decimals, 2)
      : abs >= 10
        ? Math.min(decimals, 3)
        : decimals;
  return n.toFixed(p);
}

/**
 * Parse the API's `market_cap` string (rust_decimal::Decimal serialized as a
 * JSON string, same shape as `discount`) into a plain number for sorting and
 * display. Returns null on a missing field or an unparseable value so
 * callers render "—" rather than a fabricated "$NaN" — the field is null
 * for every asset until the backend ships the market-cap migration +
 * indexer, so this null path is the common case today, not an edge case.
 */
export function parseMarketCapUsd(
  value: string | null | undefined,
): number | null {
  if (value == null) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compact USD magnitude for a parsed `market_cap` — "$1.2B" / "$430M" /
 * "$12.4M". SIZE/CONTEXT signal only, NEVER a peg-safety signal: a
 * stablecoin can still depeg at any market cap (USDC was $30B+ when its
 * SVB-driven depeg hit in March 2023). Reuses the /lst directory's TVL
 * formatter (`formatCompactUsd`) for the identical magnitude shape, but
 * returns "—" (this app's null convention everywhere else in the screener)
 * instead of lst's "-".
 */
export function formatMarketCapUsd(value: number | null): string {
  const s = formatCompactUsd(value);
  return s === "-" ? "-" : s;
}

/**
 * Parse the API's `circulating_supply` string (same rust_decimal-as-string
 * shape as `market_cap` / `discount`) into a plain number. Returns null on a
 * missing/unparseable field — null until the backend ships the market-cap
 * migration + indexer, same nullability contract as `parseMarketCapUsd`.
 */
export function parseCirculatingSupply(
  value: string | null | undefined,
): number | null {
  if (value == null) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compact token-count magnitude for a parsed `circulating_supply` — "1.24B" /
 * "417.32M" / "8.60K", no currency prefix (it's a token count, not USD). Same
 * SIZE/CONTEXT framing as `formatMarketCapUsd`: never a peg-safety signal.
 * Callers append the asset's own symbol (e.g. "417.32M jitoSOL") since the
 * unit isn't USD.
 */
export function formatSupplyCompact(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(2);
}

/**
 * Render an ISO `YYYY-MM-DD` day string as English long form, e.g.
 * `May 27, 2026`. Pass-through on any string that doesn't match the
 * expected ISO shape so callers don't need to sanity-check first.
 */
export function formatDayUS(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return iso;
  const day = Number(m[3]);
  return `${months[monthIdx]} ${day}, ${m[1]}`;
}
