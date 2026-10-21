import type { AlertRow, AssetClass, Calibration, PegState } from "./types";

/** Server cap on `GET /v1/audit?limit=` (ADR-0014). */
export const AUDIT_MAX_LIMIT = 100;

/**
 * One row of the bare JSON array returned by `GET /v1/audit`
 * (`AuditIndexRow` in crates/api-rs/src/routes/audit.rs). It carries no
 * `class`, `dispatched_at` or `discount`, and the endpoint has no `asset` or
 * `since` filter.
 */
export interface AuditIndexRow {
  id: string;
  asset: string;
  from_state: PegState;
  to_state: PegState;
  detected_at: string;
  methodology_version: string;
  receipt_sha256: string;
  onchain_tx_sig: string | null;
  monitoring_only: boolean;
  calibration: Calibration;
}

/**
 * Map audit receipts onto the `AlertRow` shape the UI consumes.
 *
 * - `class` is resolved from the asset universe; a receipt whose asset is not
 *   in the map (deactivated, or `/v1/assets` unavailable) keeps its row with
 *   class `"unknown"`, so every view lists the same receipts as `/audit`.
 * - `dispatched_at` is `null` and `discount` is absent: the index does not
 *   expose them (consumers already fall back to the live spread).
 * - Filtering (asset, since, until, paging) is the server's job.
 */
export function auditRowsToAlerts(
  rows: AuditIndexRow[],
  classBySymbol: Record<string, AssetClass>,
): AlertRow[] {
  return rows.map((r) => ({
    id: r.id,
    asset: r.asset,
    class: classBySymbol[r.asset] ?? "unknown",
    from_state: r.from_state,
    to_state: r.to_state,
    detected_at: r.detected_at,
    dispatched_at: null,
    monitoring_only: r.monitoring_only,
    calibration: r.calibration,
  }));
}

/** Day (UTC, YYYY-MM-DD) at or before which a capped paging run has no
 *  complete coverage. `null` when the whole window was fetched. */
export function coverageFloorDay(
  rows: AlertRow[],
  complete: boolean,
): string | null {
  if (complete || rows.length === 0) return null;
  return rows[rows.length - 1].detected_at.slice(0, 10);
}
