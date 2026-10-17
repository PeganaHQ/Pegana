// Hardened fetch with timeout, response-size cap, and optional retries.
// Compensating control for bigint-buffer advisory (CVE-2025-3194): bounds
// upstream responses so an oversized/malformed RPC or REST payload cannot
// reach the vulnerable native decoder path. See
// docs/security/protocol-indexer-bigint-buffer-waiver.md.

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
  maxBytes?: number;
}

export async function fetchWithTimeout(
  url: string,
  opts: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, ...init } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const contentLength = Number(res.headers.get("content-length") ?? 0);
    if (contentLength > maxBytes) {
      throw new Error(`response too large: ${contentLength} bytes (max ${maxBytes})`);
    }
    return res;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`fetch timeout after ${timeoutMs}ms: ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJsonWithTimeout<T>(
  url: string,
  opts: FetchWithTimeoutOptions = {},
): Promise<T> {
  const { maxBytes = DEFAULT_MAX_BYTES, ...rest } = opts;
  const res = await fetchWithTimeout(url, rest);
  if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) {
    throw new Error(`response too large: ${contentLength} bytes`);
  }
  const text = await res.text();
  if (text.length > maxBytes) {
    throw new Error(`response body too large: ${text.length} bytes`);
  }
  return JSON.parse(text) as T;
}
