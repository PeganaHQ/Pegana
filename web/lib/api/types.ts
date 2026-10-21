export type PegState =
  "PEGGED" | "DRIFT" | "DEPEG" | "CRITICAL" | "BLACK_SWAN" | "UNKNOWN";

export type AssetClass =
  | "lst"
  | "stable_fiat"
  | "stable_cdp"
  | "stable_rwa"
  | "stable_dn"
  | "stable_fx"
  | "synth_lev" // Hylo xSOL — leveraged SOL
  | "stable_yield"; // Hylo sHYUSD — yield-bearing stable

export type PegTarget = "SOL" | "USD" | "BRL" | "EUR";

// Pyth oracle confidence bucket — scopes the PRICE-ORACLE conf/price interval
// only, NOT market-quote / route-depth reliability. Treat an omitted/undefined
// value identically to "unknown" (neutral) — never upgrade a missing value to a
// good bucket (hardening H1/H9).
export type PythConfidence = "high" | "medium" | "low" | "unknown";

// Consumer-facing calibration label — the self-describing form of
// `monitoring_only` (`provisional` ⇔ `monitoring_only === true`). Same
// vocabulary the API emits on every read surface and the webhook canonical
// event, so "beta" can be rendered off one field everywhere.
export type Calibration = "provisional" | "calibrated";

// Advisory "amber" oracle-trust signal — BELOW the hard 500bps Pyth
// confidence gate (which forces UNKNOWN outright). Surfaces that something
// is actively off with the Pyth oracle leg right now: a wide gap vs the
// market quote, a wide conf/price interval, or a stale publish. Never the
// verdict — advisory only, never upgrades/downgrades `state`. One of
// `spread_bps` / `conf_bps` / `age_secs` accompanies the matching reason.
export interface OracleDegraded {
  reason: "oracle_divergence" | "oracle_confidence_wide" | "oracle_stale";
  // The backend (oracle_degraded.rs) lacks skip_serializing_if on these, so a
  // staleness-only trip emits them as explicit JSON `null` (not omitted) —
  // model it honestly. Consumers already guard with `!= null`.
  spread_bps?: number | null;
  conf_bps?: number | null;
  age_secs?: number | null;
}

// GET /v1/assets, GET /v1/assets/:symbol
export interface AssetCardData {
  symbol: string;
  name: string;
  mint: string;
  class: AssetClass;
  peg_target: PegTarget;
  /** What intrinsic value is measured against: "NAV" (LSTs, yield stables),
   *  "USD" (fiat, CDP, delta-neutral stables) or "FX". */
  anchor?: string | null;
  decimals: number;
  state: PegState | null;
  discount: string | null; // rust_decimal::Decimal serializes as string
  // Composite 0-100 peg-risk score (higher = riskier), anchored to `state` so it
  // never disagrees with the classification (risk_score.rs). Null for UNKNOWN and
  // CR-form (CDP) assets — a number we can't state honestly is omitted, not faked.
  risk_score: number | null;
  intrinsic_usd: string | null;
  market_usd: string | null;
  // Size/context signals (circulating_supply × price), NOT peg-safety
  // signals — a large stablecoin can still depeg (USDC was $30B+ when its
  // SVB-driven depeg hit in March 2023). Nullable until the backend ships
  // the market-cap migration + indexer; same shape/nullability as
  // `discount` above.
  market_cap: string | null; // rust_decimal::Decimal serializes as string
  circulating_supply: string | null; // rust_decimal::Decimal serializes as string
  /** Deepest-market USD liquidity from tokens.xyz's per-variant snapshot
   *  (migration 0075, `tokens_xyz_risk` indexer source). SIZE/CONTEXT only —
   *  never a peg signal, never an input to `discount`/`state`. `null` means
   *  "no market" or "not observed yet", NEVER zero: tokens.xyz has no market
   *  for 7 of the 69 active assets. Gate display on `market_context_at`. */
  liquidity_usd: string | null; // rust_decimal::Decimal serializes as string
  /** Trailing-24h USD volume. Same source, same caveats as `liquidity_usd`. */
  volume_24h_usd: string | null; // rust_decimal::Decimal serializes as string
  /** Unique holder addresses. Same source, same caveats as `liquidity_usd`. */
  holder_count: number | null;
  /** When the three market-context fields above were last observed. They move
   *  on a ~30 min cadence, far slower than `updated_at`'s discount pipeline,
   *  so they carry their own timestamp — use THIS one to gate their freshness. */
  market_context_at: string | null; // ISO 8601
  /** Server-derived 0-100 market DEPTH: how executable is the quoted price?
   *  Computed from the three fields above (`crates/api-rs/src/market_score.rs`),
   *  so any consumer can recompute it. NOT a peg score and NOT anchored to
   *  `state` — that is `risk_score`. `score` is `null` (with an
   *  `insufficient_reason`) rather than fabricated when inputs are too sparse;
   *  the whole object is absent when no context was ever observed. */
  market_depth?: {
    score: number | null;
    caps: string[];
    insufficient_reason?: string | null;
    components: {
      liquidity: number | null;
      volume: number | null;
      holders: number | null;
    };
  } | null;
  updated_at: string | null; // ISO 8601
  series_24h?: number[]; // optional — backend may not deliver yet
  /** Authoritative 24h peg-jitter: peak-to-trough RANGE of the discount over the
   *  trailing 24h (`max − min` of the MINUTE-level `discount_1m` extremes),
   *  rust_decimal signed-fraction string (×10000 → bps). More precise than a
   *  client range over the hourly-averaged `series_24h` (which smooths intra-hour
   *  spikes). BSRV-03. Distinct from `pegJitter` (stddev) — complementary, not a
   *  substitute. Omitted when no `discount_1m` rows exist in the window. */
  jitter_bps_24h?: string | null;
  /** Worst (largest-magnitude) absolute discount over the trailing 24h, same
   *  signed-fraction units (×10000 → bps). The tail-risk "how bad did the peg
   *  get" number for a peg-RISK product. BSRV-02. Emitted but not yet surfaced
   *  in the UI (available when demand warrants a net-new signal). */
  worst_abs_24h?: string | null;
  /** LSTs only — stake-pool SOL/share (rust_decimal as string). Omitted for
   *  non-LST assets. NAV decomposition: intrinsic_usd = sol_per_lst × SOL/USD.
   *  Read WITH updated_at for freshness. */
  sol_per_lst?: string;
  /** Pyth oracle confidence bucket. Omitted when no discount snapshot exists.
   *  Treat omitted/undefined as "unknown" / neutral. Gate display on updated_at. */
  confidence?: PythConfidence;
  /** Actively monitored but excluded from the calibrated denominator. This is
   *  not a health state: a monitoring-only asset can still be PEGGED. */
  monitoring_only?: boolean;
  monitoring_reason?: string;
  monitoring_since?: string;
  /** Self-describing form of `monitoring_only` — `provisional` for a beta
   *  asset, `calibrated` otherwise. Always present from the API. */
  calibration?: Calibration;
  /** Seconds the asset has resided in its CURRENT committed FSM band (engine
   *  `band_since`). Omitted until the engine has stamped it. Read WITH `state`. */
  current_state_duration_secs?: number;
  /** True when a committed alerting band (DRIFT+) has been held long enough to
   *  be a sustained episode — a slow mechanism depeg, not a blip. A
   *  PEGGED/UNKNOWN asset is never `sustained`. Omitted until computed. */
  sustained?: boolean;
  /** Advisory machine-readable reason the engine forced the current state
   *  (e.g. `premium_sanity`, `stale_source`). Present only on UNKNOWN prints;
   *  outside the canonical hash. Render via `stateReasonLabel`. */
  state_reason?: string;
  /** The amber oracle-trust flag — BELOW the hard Pyth confidence gate.
   *  Additive/optional; only populated by `GET /v1/assets/:symbol` (the
   *  single-asset detail read), never by the `GET /v1/assets` list/screener
   *  read. Omitted entirely when the oracle leg is healthy or absent — treat
   *  omitted/null identically, and gate display on `updated_at` freshness
   *  like `confidence` above (never render a stale reading). */
  oracle_degraded?: OracleDegraded | null;
  /** Per-asset alert bands (bps), served verbatim from `assets.thresholds` — the
   *  AUTHORITATIVE source that recalibrates in Postgres. The UI prefers this over
   *  the hand-maintained local table (lib/alerts/policy.ts) so a recalibration
   *  reflects immediately. Omitted/null or non-bps-shaped (e.g. hyUSD's CR
   *  thresholds) → the UI falls back to the local table. */
  thresholds?: {
    drift_bps: number;
    depeg_bps: number;
    critical_bps: number;
  } | null;
}

// GET /v1/assets/:symbol/history
export interface HistoryPoint {
  /**
   * Raw discount sample (1 - market/intrinsic) before EWMA α=0.3 smoothing.
   * Only populated for `bucket=raw`; `bucket=1m` aggregates only smoothed.
   */
  discount_raw?: string;
  /**
   * Raw USD price legs (rust_decimal as string). Only populated for
   * `bucket=raw`; the `bucket=1m` aggregate stores no legs, so both are
   * omitted there (mirrors `discount_raw`). Feed the asset-detail "Legs" view
   * — only meaningful for USD-peg assets (`peg_target === "USD"`).
   */
  intrinsic_usd?: string;
  market_usd?: string;
  /**
   * Third independent USD source (Pyth oracle price, rust_decimal as
   * string) alongside `intrinsic_usd` (NAV) and `market_usd` (DEX) — the
   * 3-leg source-divergence signal. Honest-gated server-side: present ONLY
   * where the oracle reading is independent of the DEX quote AND the asset
   * is subscribed on Pyth, else omitted entirely. Never backfilled or
   * defaulted client-side — plot it exactly when present, treat absence as
   * "no reading", not zero. Only populated for `bucket=raw`, same as the
   * other two legs.
   */
  oracle_usd?: string;
  ts: string; // ISO 8601
  discount: string;
  state: PegState;
}

// GET /v1/assets/:symbol/state
export interface AssetStateResp {
  asset: string;
  state: PegState;
  since: string;
  discount: string;
  intrinsic_usd: string;
  market_usd: string;
}

// GET /v1/audit (mapped; /v1/alerts was removed)
export interface AlertRow {
  id: string;
  asset: string;
  /** `"unknown"` for a receipt whose asset is no longer in `/v1/assets`
   *  (deactivated): the receipt is kept, never re-classified by guesswork. */
  class: AssetClass | "unknown";
  from_state: PegState;
  to_state: PegState;
  detected_at: string;
  /** `null` until the dispatcher delivers this alert to its first subscriber;
   *  stays `null` when no subscriber matched (means "not delivered", not
   *  "failed"). */
  dispatched_at: string | null;
  /** The engine's authoritative signed spread at detection (rust_decimal string).
   *  This is the alert's bps of record — /events reads it directly. (The backend
   *  does NOT emit intrinsic_usd/market_usd on alert rows, so the old
   *  reconcileBps cross-check against them was permanently dead; removed.) */
  discount?: string | null;
  /** Beta cohort flag — true for a provisional-calibration asset. Lets the
   *  /events feed badge an alert as beta per-row. */
  monitoring_only?: boolean;
  /** Self-describing form of `monitoring_only` (`provisional` | `calibrated`). */
  calibration?: Calibration;
}

// GET /v1/stats
export interface StatsResponse {
  assets_tracked: number;
  /** Active assets currently in `DRIFT` — mirror of `by_state.DRIFT`, surfaced
   *  top-level so the home/trust strip can render the single risk number
   *  without indexing into the map. */
  assets_in_drift: number;
  alerts_24h: number;
  by_state: Partial<Record<PegState, number>>;
  /**
   * Delivery-pipeline health. `failed_24h > 0` means the dashboard should
   * show a degraded indicator — historically these failures were silent
   * MarkdownV2 escape errors that dropped alerts to users without any
   * visible signal.
   */
  delivery_health: {
    sent_24h: number;
    failed_24h: number;
    last_failure_error: string | null;
  };
}

// GET /v1/calibration — per-asset calibration self-monitor
export interface CalibrationHealth {
  symbol: string;
  monitoring_only: boolean;
  /** Self-describing form of `monitoring_only` (`provisional` | `calibrated`). */
  calibration?: Calibration;
  /** Asset's own bands (bps). Omitted for non-bps (CDP) thresholds. */
  drift_bps?: number;
  depeg_bps?: number;
  /** Trailing-8d p95/p99 of |discount| in bps. Omitted when no data in window. */
  p95_bps?: number;
  p99_bps?: number;
  health: "ok" | "watch" | "miscalibrated" | "no_data" | "na";
}

// WebSocket server frames
export type ServerMsg =
  | { op: "pong" }
  | { op: "error"; msg: string }
  | { op: "update"; asset: string; payload: Record<string, unknown> }
  | { op: "heartbeat"; ts: string };

// WebSocket client frames
export type ClientMsg =
  | { op: "subscribe"; assets: string[] }
  | { op: "unsubscribe"; assets: string[] }
  | { op: "ping" };

// ── Sub-C Loop Intelligence (advisory) ─────────────────────────────────────
// Unified field names: `positions` (k-floored obligation range), `advisory_note`
// (the not-a-receipt disclaimer), `updated_at` (freshness).
export interface LoopByProtocol {
  protocol: string;
  collateral_lev_usd?: string;
  collateral_usd?: string;
  debt_usd?: string;
  positions?: string;
  coverage: string;
}
// One rung of the depeg cascade at a preset shock (compact form carried by
// /loop-exposure so the stress ladder renders from a single call).
export interface CascadeRung {
  shock_bps: number;
  liquidatable_usd: string;
  positions: string;
}
export interface LoopExposureData {
  asset: string;
  loop_exposure_usd: string;
  collateral_usd?: string;
  debt_usd: string;
  coverage: string;
  by_protocol: LoopByProtocol[];
  // Full cascade across the preset shock grid; empty/absent when no HF
  // distribution has been enumerated for the asset.
  cascade?: CascadeRung[];
  /** `partial` when fresh health-factor bands back `cascade`, else `unknown`. */
  cascade_coverage?: string;
  cascade_updated_at?: string;
  updated_at?: string;
  advisory_note: string;
}
// The tokens.xyz partner feed's per-token systemic block (also what /systemic reads).
export interface SystemicSignal {
  loop_exposure_usd: string;
  protocols: string[];
  cascade: CascadeRung[];
  coverage: string;
  /** `partial` when fresh health-factor bands back `cascade`, else `unknown`.
   *  Absent on older API builds; then fall back to `coverage`. */
  cascade_coverage?: string;
  updated_at?: string;
  advisory_note: string;
}
// One mint's entry in /v1/peg/feed. Only the fields /systemic uses are typed;
// the feed carries the full peg signal too (optional, omitted-when-absent).
export interface PegFeedSignal {
  mint: string;
  symbol: string;
  name: string;
  class: AssetClass;
  state?: PegState;
  systemic?: SystemicSignal;
}
export interface PegFeedResponse {
  ok: boolean;
  methodology: string;
  generated_at: string;
  count: number;
  // Array of per-token signals; each carries its own `mint`.
  data: PegFeedSignal[];
}
export interface SimulateByProtocol {
  protocol: string;
  liquidatable_usd: string;
  positions: string;
}
export interface SimulateDepegData {
  asset: string;
  shock_bps: number;
  loop_exposure_usd: string;
  liquidatable_usd: string;
  positions: string;
  coverage: string;
  by_protocol: SimulateByProtocol[];
  advisory_note: string;
  updated_at?: string;
}
