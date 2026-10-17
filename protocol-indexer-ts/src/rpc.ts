// Solana JSON-RPC with primary -> fallback failover — the TS analog of
// crates/indexer-rs/src/rpc.rs. On a primary error we increment
// `pegana_protocol_rpc_primary_failed_total{op}` and retry the fallback.

import { incr } from "./metrics";
import { fetchWithTimeout } from "./fetch-util";

const PRIMARY = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const FALLBACK =
  process.env.SOLANA_RPC_URL_FALLBACK ?? "https://solana-rpc.publicnode.com";

async function rpcCall(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`rpc ${method} http ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`rpc ${method}: ${json.error.message}`);
  return json.result;
}

// Try the primary RPC; on failure, record it and fall back. Callers pass the
// JSON-RPC method + params; the caller decodes the result.
export async function rpcWithFallback(
  method: string,
  params: unknown[],
): Promise<unknown> {
  try {
    return await rpcCall(PRIMARY, method, params);
  } catch (e) {
    incr("pegana_protocol_rpc_primary_failed_total", { method });
    console.warn(`[rpc] primary ${method} failed, trying fallback:`, String(e));
    return rpcCall(FALLBACK, method, params);
  }
}

// Generic primary->fallback wrapper for SDK-style callbacks that take an RPC
// endpoint (Kamino/Jupiter SDKs are constructed with a Connection/endpoint).
export async function withRpcFallback<T>(
  op: string,
  fn: (endpoint: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(PRIMARY);
  } catch (e) {
    incr("pegana_protocol_rpc_primary_failed_total", { op });
    console.warn(`[rpc] primary ${op} failed, trying fallback:`, String(e));
    return fn(FALLBACK);
  }
}
