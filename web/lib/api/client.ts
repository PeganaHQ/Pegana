import type {
  AssetCardData,
  AssetStateResp,
  AlertRow,
  CalibrationHealth,
  HistoryPoint,
  StatsResponse,
  LoopExposureData,
  SimulateDepegData,
  PegFeedResponse,
} from "./types";
import { apiBase } from "./base";

// Custom Error subclass so callers can branch on HTTP status (e.g. 404 vs
// network drop) without parsing the message string.
export class ApiError extends Error {
  status?: number;
  path: string;
  constructor(message: string, path: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.path = path;
    this.status = status;
  }
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
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
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
    throw new ApiError(`API ${res.status} on ${path}`, path, res.status);
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
    return fetchList<AssetCardData>(`/v1/assets${s ? `?${s}` : ""}`);
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
  alerts: (opts?: {
    asset?: string;
    class?: string;
    limit?: number;
    since?: string;
  }) => {
    const q = new URLSearchParams();
    if (opts?.asset) q.set("asset", opts.asset);
    if (opts?.class) q.set("class", opts.class);
    if (opts?.limit) q.set("limit", String(opts.limit));
    if (opts?.since) q.set("since", opts.since);
    const s = q.toString();
    return fetchList<AlertRow>(`/v1/alerts${s ? `?${s}` : ""}`);
  },
};
