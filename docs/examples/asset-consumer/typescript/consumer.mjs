/**
 * Pegana asset consumer — TypeScript/ESM reference implementation.
 *
 * Demonstrates how an explorer or wallet (e.g. tokens.xyz) fetches
 * GET https://api.pegana.xyz/v1/assets and renders each asset's peg
 * status correctly using the `anchor` field.
 *
 * Zero external dependencies — runs with Node 18+ or Deno.
 *
 * Usage:
 *   node consumer.mjs
 *
 * Key contract:
 *   - Resolve assets by `mint` (the stable join key across updates).
 *   - TRUST the engine's `state` — never re-threshold `discount` yourself.
 *     An LST trading at −1.4% is PEGGED; its drift band is wider than a
 *     stablecoin's.
 *   - Use `anchor` to decide how to phrase the deviation:
 *       "USD" → "X% from $1"           (classic stablecoin)
 *       "FX"  → "X% from the <target> peg"  (EURC, BRL-backed, etc.)
 *       "NAV" → "X% from NAV"          (LST / fund share — NAV itself moves)
 *   - Always surface `confidence`; a "low" or "unknown" reading means
 *     oracle data is thin — don't render a confident number.
 *   - Flag `calibration === "provisional"` (beta, experimental); the
 *     methodology is still being validated on mainnet data.
 *   - Flag `state === "UNKNOWN"` (fail-safe / degraded) — the engine
 *     withheld a verdict because inputs were contradictory or stale.
 *   - `discount` is a fraction (e.g. 0.012 = 1.2% below fair value).
 *     Positive → premium above fair value; negative → discount below.
 */

const ASSETS_URL = "https://api.pegana.xyz/v1/assets";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {"USD"|"FX"|"NAV"} Anchor
 * @typedef {"PEGGED"|"DRIFT"|"DEPEG"|"CRITICAL"|"BLACK_SWAN"|"UNKNOWN"} PegState
 * @typedef {"high"|"medium"|"low"|"unknown"} Confidence
 * @typedef {"calibrated"|"provisional"} Calibration
 */

/**
 * @typedef {Object} PeganaAsset
 * @property {string}      symbol
 * @property {string}      name
 * @property {string}      mint          - Solana mint address (stable join key)
 * @property {string}      class         - "stablecoin" | "lst" | "lp" | …
 * @property {Anchor}      anchor        - How to interpret the discount
 * @property {string}      peg_target    - "USD" | "EUR" | "BRL" | "SOL" | …
 * @property {number}      decimals
 * @property {PegState}    state         - Engine's class-aware verdict (trust this)
 * @property {Confidence}  confidence    - Oracle confidence for this reading
 * @property {string}      discount      - Fraction string, e.g. "0.012" = 1.2%
 * @property {string}      intrinsic_usd - NAV / fair value in USD
 * @property {string}      market_usd    - Observed market price in USD
 * @property {boolean}     monitoring_only - True = not yet in calibrated launch set
 * @property {Calibration} calibration   - "provisional" = methodology still validating
 * @property {string|null} monitoring_reason
 * @property {string|null} monitoring_since
 * @property {string}      jitter_bps_24h
 */

// ─── Fetch + index ────────────────────────────────────────────────────────────

/**
 * Fetches the current asset list and returns a mint-keyed Map.
 * Poll at most every 30–60 s; the API has short internal caching.
 *
 * @returns {Promise<Map<string, PeganaAsset>>}
 */
async function fetchAssets() {
  const res = await fetch(ASSETS_URL, {
    headers: { "Accept": "application/json" },
    // Always set a sensible timeout to avoid hanging.
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`/v1/assets returned HTTP ${res.status}`);
  }
  // List endpoints return the envelope `{ ok, generated_at, count, data }` —
  // read the rows from `data`.
  const body = await res.json();
  /** @type {PeganaAsset[]} */
  const assets = Array.isArray(body) ? body : body.data;

  // Index by mint for O(1) lookup by any consumer that already holds a
  // mint address (the typical case in wallets/explorers).
  /** @type {Map<string, PeganaAsset>} */
  const byMint = new Map();
  for (const asset of assets) {
    byMint.set(asset.mint, asset);
  }
  return byMint;
}

// ─── Anchor-aware rendering ───────────────────────────────────────────────────

/**
 * State badge colours suitable for any UI system.
 * Map each PegState to a semantic token your design system uses.
 */
const STATE_BADGE = {
  PEGGED:     { label: "Pegged",     color: "green"  },
  DRIFT:      { label: "Drift",      color: "yellow" },
  DEPEG:      { label: "Depeg",      color: "orange" },
  CRITICAL:   { label: "Critical",   color: "red"    },
  BLACK_SWAN: { label: "Black Swan", color: "red"    },
  UNKNOWN:    { label: "Unknown",    color: "gray"   },
};

/**
 * Formats a discount fraction as a signed percentage string.
 * e.g. -0.014869 → "-1.49%"   0.000153 → "+0.02%"
 *
 * @param {string|number} discount
 * @param {number} [decimals=2]
 * @returns {string}
 */
function formatPct(discount, decimals = 2) {
  const n = typeof discount === "string" ? parseFloat(discount) : discount;
  const pct = n * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

/**
 * Renders a human-readable peg description for one asset.
 *
 * This is the core M1 adapter function: an external consumer (explorer,
 * wallet, aggregator) can call this without knowing Pegana's internal
 * taxonomy. The `anchor` field drives the correct framing.
 *
 * Rules:
 *   - state === "UNKNOWN"          → fail-safe; engine withheld a verdict.
 *     Surface the badge but do NOT display a confident number.
 *   - calibration === "provisional" → beta; flag as experimental.
 *   - anchor === "USD"             → "X% from $1"
 *   - anchor === "FX"              → "X% from the <peg_target> peg"
 *   - anchor === "NAV"             → "X% from NAV"
 *     (NAV itself moves — don't label this as a "$1 depeg")
 *   - confidence === "low"|"unknown" → note uncertainty in the label.
 *
 * @param {PeganaAsset} asset
 * @returns {{ label: string, state: string, color: string, notes: string[] }}
 */
function renderPeg(asset) {
  const badge = STATE_BADGE[asset.state] ?? { label: asset.state, color: "gray" };
  const notes = [];

  // Fail-safe / degraded: engine withheld verdict — no confident number.
  if (asset.state === "UNKNOWN") {
    return {
      label: "Peg status unavailable",
      state: asset.state,
      color: badge.color,
      notes: [
        "Engine in fail-safe mode — oracle inputs contradictory or stale.",
        ...(asset.calibration === "provisional" ? ["Beta: methodology provisional."] : []),
      ],
    };
  }

  // Beta flag: methodology is still being validated.
  if (asset.calibration === "provisional") {
    notes.push("Beta: provisional calibration — treat as experimental.");
  }

  // Low/unknown oracle confidence: flag the uncertainty.
  if (asset.confidence === "low" || asset.confidence === "unknown") {
    notes.push(`Oracle confidence: ${asset.confidence} — reading may be unreliable.`);
  }

  // Build the deviation label, anchor-aware.
  const pct = formatPct(asset.discount);
  let deviationLabel;

  switch (asset.anchor) {
    case "USD":
      // Classic stablecoin pegged 1:1 to the US dollar.
      deviationLabel = `${pct} from $1`;
      break;

    case "FX":
      // Fiat-backed token tracking a non-USD currency (e.g. EURC → EUR).
      // peg_target tells you which currency — use it, don't hard-code "EUR".
      deviationLabel = `${pct} from the ${asset.peg_target} peg`;
      break;

    case "NAV":
      // Liquid staking token or fund share. Fair value (NAV) moves with
      // the underlying (e.g. staked SOL accrues rewards). A −1.4% reading
      // is normal for a healthy LST.  Do NOT say "from $1" here.
      deviationLabel = `${pct} from NAV`;
      break;

    default:
      // Forward-compatible: unknown future anchor type.
      deviationLabel = `${pct} deviation`;
      break;
  }

  return {
    label: `${badge.label} · ${deviationLabel}`,
    state: asset.state,
    color: badge.color,
    notes,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Fetching ${ASSETS_URL} …\n`);
  const byMint = await fetchAssets();

  console.log(`Loaded ${byMint.size} assets.\n`);
  console.log("─".repeat(72));

  for (const asset of byMint.values()) {
    const rendered = renderPeg(asset);
    const provFlag = asset.calibration === "provisional" ? " [beta]" : "";
    const moFlag   = asset.monitoring_only ? " [monitoring-only]" : "";
    console.log(`${asset.symbol.padEnd(12)} ${asset.mint.slice(0, 8)}…`);
    console.log(`  anchor:${asset.anchor.padEnd(5)} state:${asset.state.padEnd(11)} conf:${asset.confidence}`);
    console.log(`  → ${rendered.label}${provFlag}${moFlag}`);
    if (rendered.notes.length) {
      for (const n of rendered.notes) console.log(`     ⚠ ${n}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
