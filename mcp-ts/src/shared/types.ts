import { roundDecimal } from "@/shared/decimal";

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

/**
 * A live snapshot as the MCP tools expose it. Exactly these keys: the tool
 * outputSchemas are published with `additionalProperties: false`, so any extra
 * wire key (the engine's `kind`, a raw `updated_at` with nanoseconds) makes a
 * strict MCP client (the official SDK validates with AJV) reject the result.
 */
export interface DiscountSnapshot {
  asset: string;
  intrinsic_usd: string;
  market_usd: string;
  discount: string;
  state: PegState;
  /** Unix seconds of the engine recompute. */
  ts: number;
  /** Same instant as `ts`, ISO-8601 with milliseconds (`...Z`), like REST. */
  updated_at: string;
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

// Wire payload -> DiscountSnapshot.
//
// Engine publishes the wire payload as
//   { kind:"update", asset, state, discount, intrinsic_usd, market_usd,
//     updated_at: "<RFC3339, nanoseconds>" }
// (see crates/engine-rs/src/main.rs publish_discount). The MCP tool output
// schema expects `ts: number` (unix seconds). Without the mapping below,
// `ts` is `undefined`, every get_assets / get_asset_state call fails Zod
// validation, and the MCP server returns -32602 to any consumer. Caught
// during the 2026-05-29 surface QA — see docs/operations/qa-pre-launch-workflow.md.
//
// Formatting mirrors REST so the two surfaces agree on the same snapshot:
// `discount` is rounded to the 6 dp the DB stores (NUMERIC(10,6)), USD legs to
// 18 dp (NUMERIC(30,18)), all without trailing zeros; `updated_at` is ISO with
// milliseconds. Returns `undefined` when the payload has no usable timestamp:
// inventing one (e.g. "now") would make stale data look fresh.
export interface DiscountWire {
  asset: string;
  state: string;
  discount: string;
  intrinsic_usd: string;
  market_usd: string;
  ts?: number;
  updated_at?: string;
  kind?: string;
}

export function normalizeDiscountSnapshot(
  snap: DiscountWire,
): DiscountSnapshot | undefined {
  let ms: number;
  if (typeof snap.ts === "number" && Number.isFinite(snap.ts)) {
    ms = snap.ts * 1000;
  } else if (typeof snap.updated_at === "string") {
    ms = Date.parse(snap.updated_at);
  } else {
    return undefined;
  }
  if (!Number.isFinite(ms)) return undefined;
  return {
    asset: snap.asset,
    state: normalizePegState(snap.state),
    discount: roundDecimal(String(snap.discount), 6),
    intrinsic_usd: roundDecimal(String(snap.intrinsic_usd), 18),
    market_usd: roundDecimal(String(snap.market_usd), 18),
    ts: Math.floor(ms / 1000),
    updated_at: new Date(Math.floor(ms)).toISOString(),
  };
}

/**
 * Parse one `pegana:discount` channel message. The engine publishes two kinds
 * on this channel:
 *   { kind: "update", asset, state, discount, ... } — the real data
 *   { kind: "heartbeat", ts: ISO }                  — liveness ping
 * Heartbeats have no `asset`, so caching them would create a poisoned entry
 * under key `undefined`. A missing `kind` is treated as "update" for
 * back-compat with the historical payload shape. Returns `undefined` for
 * anything that is not a complete update.
 */
export function parseDiscountMessage(raw: string): DiscountSnapshot | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const p = parsed as Partial<DiscountWire>;
  if (p.kind && p.kind !== "update") return undefined;
  if (typeof p.asset !== "string" || p.asset.length === 0) return undefined;
  for (const k of ["state", "discount", "intrinsic_usd", "market_usd"] as const) {
    if (typeof p[k] !== "string" && typeof p[k] !== "number") return undefined;
  }
  return normalizeDiscountSnapshot(p as DiscountWire);
}
