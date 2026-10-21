// Shared zod shapes for the live-snapshot tools (get_assets, get_asset_state).
//
// One definition so the two tools cannot drift, and so the published JSON
// outputSchema lists every key the handlers emit (the SDK publishes these with
// `additionalProperties: false`; a strict client rejects any undeclared key).

import { z } from "zod";

export const PEG_STATES = [
  "PEGGED",
  "DRIFT",
  "DEPEG",
  "CRITICAL",
  "BLACK_SWAN",
  "UNKNOWN",
] as const;

/** A snapshot older than this is stale (same 5 min gate get_asset_state uses). */
export const STALE_AFTER_SEC = 300;

export const snapshotShape = {
  asset: z.string(),
  state: z.enum(PEG_STATES),
  discount: z
    .string()
    .describe(
      "1 - market/intrinsic as a decimal string (6 dp, like REST): negative = ABOVE intrinsic (a premium), positive = BELOW (a discount). E.g. `-0.0042` = 42bps above intrinsic (a premium).",
    ),
  intrinsic_usd: z.string().describe("Intrinsic value in USD, decimal string."),
  market_usd: z.string().describe("Market price in USD, decimal string."),
  ts: z.number().int().describe("Unix seconds at the snapshot timestamp."),
  updated_at: z
    .string()
    .describe("Same instant as `ts`, ISO-8601 with milliseconds (UTC), as REST returns it."),
};

export function ageSeconds(ts: number, nowMs: number = Date.now()): number {
  return Math.max(0, Math.floor(nowMs / 1000 - ts));
}

/**
 * Freshness of an upstream model result (`updated_at` ISO string) against the
 * writer's cadence. Returns `{}` when there is no parseable timestamp, so
 * nothing is invented. R1 audit idx 33: simulate_depeg_impact served HF bands
 * frozen for ~3 days with nothing in the response saying so.
 */
export function freshness(
  updatedAt: unknown,
  staleAfterSec: number,
  nowMs: number = Date.now(),
): { stale?: boolean; data_age_sec?: number } {
  if (typeof updatedAt !== "string") return {};
  const ms = Date.parse(updatedAt);
  if (!Number.isFinite(ms)) return {};
  const age = Math.max(0, Math.floor((nowMs - ms) / 1000));
  return { stale: age > staleAfterSec, data_age_sec: age };
}

export const freshnessShape = (cadence: string, staleAfterSec: number, scopeNote = "") => ({
  stale: z
    .boolean()
    .optional()
    .describe(
      `True when updated_at is more than ${staleAfterSec}s old (the source refreshes ${cadence}): the figures are last-known, not current. Absent when there is no updated_at.${scopeNote ? ` ${scopeNote}` : ""}`,
    ),
  data_age_sec: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Seconds between updated_at and the time of this response."),
});
