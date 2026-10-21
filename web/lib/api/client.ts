import type {
  AssetCardData,
  AssetStateResp,
  AlertRow,
  AssetClass,
  CalibrationHealth,
  HistoryPoint,
  StatsResponse,
  LoopExposureData,
  SimulateDepegData,
  PegFeedResponse,
} from "./types";
import { apiBase, serverApiHeaders } from "./base";
import {
  AUDIT_MAX_LIMIT,
  auditRowsToAlerts,
  coverageFloorDay,
  type AuditIndexRow,
} from "./audit-alerts";

// Custom Error subclass so callers can branch on HTTP status (e.g. 404 vs
// network drop) without parsing the message string.
export class ApiError extends Error {
  status?: number;
  path: string;
  /** Seconds from the `Retry-After` header on a 429 (exposed via CORS). */
  retryAfterSec?: number;
  constructor(
    message: string,
    path: string,
    status?: number,
    retryAfterSec?: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.path = path;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

/** Parse a `Retry-After` header: delta-seconds or an HTTP date. */
export function parseRetryAfter(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * True when the API refused the request because this client IP used up its
 * public budget (60/min). That is NOT an outage and must never be worded as
 * one: the API is healthy, this browser just has to wait.
 */
export function isRateLimited(err: unknown): boolean {
  return (err as { status?: number } | null | undefined)?.status === 429;
}

// Hard per-request deadline. Without it, a slow/hung endpoint keeps the SWR
// hook `isLoading` forever and the page shows its skeleton indefinitely (the
// 2026-07-25 incident: a backend query hung ~90s). 15s is well above every
// healthy /v1 response (slowest measured ~4.4s) yet fails fast into the
// existing ApiError → "feed unreachable" surface instead of hanging.
const REQUEST_TIMEOUT_MS = 15_000;

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...serverApiHeaders(),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      // A caller-supplied signal (none today) still wins; otherwise apply the
      // timeout. `AbortSignal.timeout` is Baseline-2022 / Node 18+.
      signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    // TypeError on network failure (DNS, connection refused, CORS) OR a
    // TimeoutError/AbortError DOMException when the deadline above fires. Both
    // collapse to the same ApiError (no status) so consumers don't need a
    // second branch — the asset page renders its "feed unreachable" state.
    throw new ApiError(`API unreachable on ${path}`, path);
  }
  if (!res.ok)
    throw new ApiError(
      `API ${res.status} on ${path}`,
      path,
      res.status,
      res.status === 429
        ? parseRetryAfter(res.headers?.get?.("retry-after"))
        : undefined,
    );
  return res.json() as Promise<T>;
}

// List endpoints return the uniform envelope
// `{ ok, generated_at, count, data: [...] }`; `fetchList` unwraps `data` so
// callers get the `T[]` they expect.
async function fetchList<T>(path: string, init?: RequestInit): Promise<T[]> {
  const body = await fetchJson<{ data: T[] }>(path, init);
  return body.data;
}

export const api = {
  stats: () => fetchJson<StatsResponse>("/v1/stats"),
  calibration: () => fetchList<CalibrationHealth>("/v1/calibration"),
  assets: (opts?: { class?: string; peg?: string }) => {
    const q = new URLSearchParams();
    if (opts?.class) q.set("class", opts.class);
    if (opts?.peg) q.set("peg", opts.peg);
    const s = q.toString();
    return s
      ? fetchList<AssetCardData>(`/v1/assets?${s}`)
      : fetchAssetUniverse();
  },
  asset: (symbol: string) =>
    fetchJson<AssetCardData>(`/v1/assets/${encodeURIComponent(symbol)}`),
  // Sub-C Loop Intelligence — advisory leverage exposure + cascade estimate.
  loopExposure: (symbol: string) =>
    fetchJson<LoopExposureData>(
      `/v1/assets/${encodeURIComponent(symbol)}/loop-exposure`,
    ),
  simulateDepeg: (symbol: string, shockBps: number) =>
    fetchJson<SimulateDepegData>(
      `/v1/assets/${encodeURIComponent(symbol)}/simulate-depeg?shock_bps=${shockBps}`,
    ),
  // The mint-keyed partner feed — the /systemic page reads it (one fetch) to rank
  // every token's cross-protocol leverage + cascade.
  pegFeed: () => fetchJson<PegFeedResponse>(`/v1/peg/feed`),
  assetState: (symbol: string) =>
    fetchJson<AssetStateResp>(`/v1/assets/${encodeURIComponent(symbol)}/state`),
  assetHistory: (
    symbol: string,
    opts?: {
      bucket?: "raw" | "1m";
      from?: string;
      to?: string;
      limit?: number;
    },
  ) => {
    const q = new URLSearchParams();
    if (opts?.bucket) q.set("bucket", opts.bucket);
    if (opts?.from) q.set("from", opts.from);
    if (opts?.to) q.set("to", opts.to);
    if (opts?.limit) q.set("limit", String(opts.limit));
    const s = q.toString();
    return fetchList<HistoryPoint>(
      `/v1/assets/${encodeURIComponent(symbol)}/history${s ? `?${s}` : ""}`,
    );
  },
  // Peg-state transitions, read from the receipts ledger. `/v1/alerts` was
  // removed; `/v1/audit` returns a bare JSON array (no envelope), at most 100
  // rows per page, newest first, filtered server-side by asset/since/until and
  // paged with the `before` (+ `before_id`) keyset cursor. `class` is joined
  // from /v1/assets and degrades to "unknown" if that call fails.
  alerts: async (opts?: AlertsQuery): Promise<AlertRow[]> => {
    const [rows, classes] = await Promise.all([
      fetchAuditPage(opts),
      fetchClassMap(),
    ]);
    const mapped = auditRowsToAlerts(rows, classes);
    return opts?.class ? mapped.filter((a) => a.class === opts.class) : mapped;
  },
  // Pages `/v1/audit` newest-to-oldest until the window is exhausted or
  // `maxPages` is hit. `complete=false` means older receipts may exist beyond
  // the oldest returned row; callers must treat that span as unknown, not calm.
  alertsWindow: async (opts: {
    since: string;
    asset?: string;
    maxPages?: number;
    excludePegged?: boolean;
  }): Promise<AlertsWindow> => {
    const maxPages = opts.maxPages ?? 10;
    const classes = fetchClassMap();
    const all: AuditIndexRow[] = [];
    let before: AuditIndexRow | undefined;
    let complete = false;
    for (let page = 0; page < maxPages; page++) {
      const rows = await fetchAuditPage({
        since: opts.since,
        asset: opts.asset,
        excludePegged: opts.excludePegged,
        limit: AUDIT_MAX_LIMIT,
        before: before?.detected_at,
        beforeId: before?.id,
      });
      all.push(...rows);
      if (rows.length < AUDIT_MAX_LIMIT) {
        complete = true;
        break;
      }
      before = rows[rows.length - 1];
    }
    const rows = auditRowsToAlerts(all, await classes);
    return { rows, complete, coverageFloorDay: coverageFloorDay(rows, complete) };
  },
};

export interface AlertsQuery {
  asset?: string;
  class?: string;
  limit?: number;
  since?: string;
  until?: string;
  before?: string;
  beforeId?: string;
  /** Server `exclude_pegged`. Default false here (recoveries included); the
   *  server's own default is true. */
  excludePegged?: boolean;
}

export interface AlertsWindow {
  rows: AlertRow[];
  /** True when paging reached the end of the window. */
  complete: boolean;
  /** UTC day at or before which coverage is incomplete (cap hit), else null. */
  coverageFloorDay: string | null;
}

function fetchAuditPage(opts?: AlertsQuery): Promise<AuditIndexRow[]> {
  const q = new URLSearchParams({
    limit: String(Math.min(opts?.limit ?? AUDIT_MAX_LIMIT, AUDIT_MAX_LIMIT)),
    exclude_pegged: String(opts?.excludePegged ?? false),
  });
  if (opts?.asset) q.set("asset", opts.asset);
  if (opts?.since) q.set("since", opts.since);
  if (opts?.until) q.set("until", opts.until);
  if (opts?.before) q.set("before", opts.before);
  if (opts?.beforeId) q.set("before_id", opts.beforeId);
  return fetchJson<AuditIndexRow[]>(`/v1/audit?${q.toString()}`);
}

// ── Shared asset universe ────────────────────────────────────────────────
//
// `api.alerts` joins each receipt's class from /v1/assets. It used to fetch
// the full list itself on every call, next to the useAssets() poll that was
// already fetching the same list: on /dashboard that was 2 x /v1/assets at load
// and again on every 30s alerts refresh (measured 2026-10-21, about 2 extra
// requests a minute per tab against a 60/min per-IP budget).
//
// Now one in-flight request is shared, and the class map reuses the most
// recent list for CLASS_MAP_TTL_MS. A class changes only when an asset is
// reclassified, which is rare and harmless to pick up a few minutes late.
const CLASS_MAP_TTL_MS = 10 * 60_000;
let universeInflight: Promise<AssetCardData[]> | null = null;
let universeLast: { at: number; data: AssetCardData[] } | null = null;

function fetchAssetUniverse(): Promise<AssetCardData[]> {
  if (universeInflight) return universeInflight;
  const p = fetchList<AssetCardData>("/v1/assets")
    .then((data) => {
      universeLast = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      universeInflight = null;
    });
  universeInflight = p;
  return p;
}

/** Test hook: forget the shared universe between tests. */
export function __resetAssetUniverseForTests(): void {
  universeInflight = null;
  universeLast = null;
}

async function fetchClassMap(): Promise<Record<string, AssetClass>> {
  try {
    const assets =
      universeLast && Date.now() - universeLast.at < CLASS_MAP_TTL_MS
        ? universeLast.data
        : await fetchAssetUniverse();
    const out: Record<string, AssetClass> = {};
    for (const a of assets) out[a.symbol] = a.class;
    return out;
  } catch {
    return {};
  }
}
