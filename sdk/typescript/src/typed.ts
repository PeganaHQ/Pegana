// Full typed Pegana API client — v0.2.0.
//
// Covers every `/v1` endpoint with per-operation typed `data`/`error`, driven by
// `src/schema.d.ts` (auto-generated from the live OpenAPI 3.1 spec at
// https://api.pegana.xyz/openapi.json — regenerate with `bun run gen`). This is
// the v0.2.0 surface; the stable v0.1 receipt-verification helpers
// (`PeganaClient`, `getAudit`/`getAuditIndex`/`getOnchain`/`verifyAlert`) remain
// exported from `./index` unchanged for backward compatibility.
//
// Kept `private: true` in package.json (publish is a founder decision, v0.3.0).

import createClient, { type Client, type Middleware } from "openapi-fetch";
import type { paths } from "./schema.js";

// Re-export the generated types so consumers can name request/response shapes.
export type { paths, components, operations } from "./schema.js";

export interface PeganaApiOptions {
  /** API base URL. Defaults to the public hosted endpoint. */
  baseUrl?: string;
  /**
   * Optional bearer token sent as `Authorization: Bearer ...`. The public
   * read-only API needs none; omit it.
   */
  token?: string;
  /** Custom fetch (e.g. undici); defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

const DEFAULT_BASE = "https://api.pegana.xyz";

/**
 * Create a fully-typed Pegana API client covering all `/v1` endpoints.
 *
 * ```ts
 * const api = createPeganaApi();
 * const { data, error } = await api.GET("/v1/assets");
 * if (data) for (const a of data.data) console.log(a.symbol); // list → .data
 *
 * const one = await api.GET("/v1/assets/{symbol}", {
 *   params: { path: { symbol: "USDC" } },
 * });                                                          // single → bare
 *
 * const audit = await api.GET("/v1/audit");                    // receipts ledger
 * ```
 *
 * Conventions (ADR-0043): LIST endpoints return the envelope
 * `{ ok, generated_at, count, data }` — read `.data` (or {@link unwrapList});
 * SINGLE resources are bare. Money fields are exact decimal STRINGS (never
 * floats) — parse with a decimal library for arithmetic.
 */
export function createPeganaApi(opts: PeganaApiOptions = {}): Client<paths> {
  const client = createClient<paths>({
    baseUrl: (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, ""),
    fetch: opts.fetch,
  });
  if (opts.token) {
    const token = opts.token;
    const auth: Middleware = {
      onRequest({ request }) {
        request.headers.set("Authorization", `Bearer ${token}`);
        return request;
      },
    };
    client.use(auth);
  }
  return client;
}

/**
 * Unwrap the ADR-0043 list envelope to its `data` array (empty array when the
 * envelope is null/undefined). List endpoints (`/v1/assets`, `/v1/audit`,
 * `/v1/calibration`, `/v1/peg/feed`, `…/history`) return the envelope; single
 * resources are bare and need no unwrap.
 */
export function unwrapList<T>(envelope: { data: T[] } | null | undefined): T[] {
  return envelope?.data ?? [];
}

/**
 * DISPLAY-ONLY coercion of a Pegana money/decimal STRING to a number. Pegana
 * serialises monetary values as exact decimal strings (trailing zeros trimmed,
 * USD rounded to cents) — NEVER floats. Use only for rendering; for arithmetic
 * or comparison parse with a decimal library (e.g. decimal.js) to avoid
 * IEEE-754 precision loss on large values.
 */
export function toNumberUnsafe(decimalString: string): number {
  return Number(decimalString);
}
