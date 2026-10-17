// Wire-format types mirrored from `web/lib/api/types.ts`. The web client
// has been in production with these strings; they are the consumer
// contract. Rust enums on the engine side serialize via serde to
// (mostly) the same strings — see `normalizePegState` below for the
// one historical inconsistency.

export type PegState =
  | "PEGGED"
  | "DRIFT"
  | "DEPEG"
  | "CRITICAL"
  | "BLACK_SWAN"
  | "UNKNOWN";

export type AssetClass =
  | "lst"
  | "stable_fiat"
  | "stable_cdp"
  | "stable_rwa"
  | "stable_dn"
  | "stable_fx"
  | "synth_lev"
  | "stable_yield";

export type PegTarget = "SOL" | "USD" | "BRL" | "EUR";

export interface DiscountSnapshot {
  asset: string;
  intrinsic_usd: string;
  market_usd: string;
  discount: string;
  state: PegState;
  ts: number;
}

export interface AlertEvent {
  id: string;
  asset: string;
  class: AssetClass;
  peg_target: PegTarget;
  from_state: PegState;
  to_state: PegState;
  discount: string;
  intrinsic_usd: string;
  market_usd: string;
  ts: number;
}

export const CHANNELS = {
  DISCOUNT: "pegana:discount",
  ALERTS: "pegana:alerts",
} as const;

// VERIFY note from Plan 2 B1: the engine writes to `pegana:alerts` via
// serde with `#[serde(rename_all = "UPPERCASE")]` on PegState, which
// produces `BLACKSWAN` (no underscore). api-rs REST output via
// Postgres enum `::text` cast produces `BLACK_SWAN`. To present a
// unified surface, normalize incoming Redis JSON before exposing it.
//
// To confirm the actual wire string on prod-local:
//   redis-cli -p 6381 SUBSCRIBE pegana:alerts
//   # trigger a synthetic BlackSwan transition and inspect the JSON.
//
// If the wire turns out to be `BLACK_SWAN` already, this function is a
// no-op — safe to leave in either way.
export function normalizePegState(s: string): PegState {
  if (s === "BLACKSWAN") return "BLACK_SWAN";
  return s as PegState;
}

// Normalize a parsed AlertEvent in-place (mutates `from_state` and
// `to_state`). Returns the same object for chaining.
export function normalizeAlertEvent(evt: AlertEvent): AlertEvent {
  evt.from_state = normalizePegState(evt.from_state);
  evt.to_state = normalizePegState(evt.to_state);
  return evt;
}

// Same for a DiscountSnapshot.
//
// Engine publishes the wire payload as
//   { kind:"update", asset, state, discount, intrinsic_usd, market_usd,
//     updated_at: "<ISO-8601>" }
// (see crates/engine-rs/src/main.rs publish_discount). The MCP tool output
// schema expects `ts: number` (unix seconds). Without the mapping below,
// `ts` is `undefined`, every get_assets / get_asset_state call fails Zod
// validation, and the MCP server returns -32602 to any consumer. Caught
// during the 2026-05-29 surface QA — see docs/operations/qa-pre-launch-workflow.md.
export function normalizeDiscountSnapshot(
  // Wire shape uses `updated_at` (ISO); fall through to `ts` for
  // forward-compat if the engine ever switches.
  snap: DiscountSnapshot & { updated_at?: string },
): DiscountSnapshot {
  snap.state = normalizePegState(snap.state);
  if (typeof snap.ts !== "number" && typeof snap.updated_at === "string") {
    const ms = Date.parse(snap.updated_at);
    // Date.parse returns NaN on bad input. Fall back to "now" so the asset
    // is at least cached — the alternative is dropping the snapshot
    // entirely, which makes the asset invisible to agents.
    snap.ts = Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
  }
  return snap;
}
