// Pegana TypeScript SDK — minimal hand-rolled wrapper.
//
// v0.1.0 ships four functions covering the public-receipt verification
// flow. Full OpenAPI-generated coverage (all 33+ endpoints) is deferred to
// v0.2.0; the spec lives at https://api.pegana.xyz/openapi.json.
//
// Why hand-rolled for v0.1.0:
//   - Keeps install footprint tiny (no openapi-fetch / undici peer dep).
//   - Lets us ship a stable v0.1 surface that maps 1:1 to the public docs.
//   - Lets consumers pin to a working version while we iterate the API.
//
// Marked `private: true` in package.json so the npm publish step in
// CI can't accidentally push it to the registry. Flip to public once the
// generated SDK lands.

// v0.2.0 — the full OpenAPI-generated typed client + helpers (`createPeganaApi`,
// `unwrapList`, `toNumberUnsafe`) and the generated `paths`/`components`/
// `operations` types, covering every `/v1` endpoint. The v0.1 receipt-
// verification surface below (`PeganaClient` + the four convenience fns) is
// unchanged for backward compatibility.
export * from "./typed.js";

// Live peg-feed WebSocket helper (`PegFeed` / `connectPegFeed`) — the one
// endpoint OpenAPI can't model (`/v1/ws` is a spec stub). Completes v0.2.0.
export * from "./ws.js";

export interface PeganaClientOptions {
  /**
   * Base URL of the Pegana API. Defaults to the public hosted endpoint.
   * Override for staging / self-hosted deployments.
   */
  baseUrl?: string;
  /**
   * Custom fetch implementation (e.g. node-fetch, undici). Defaults to
   * globalThis.fetch which is available on Node ≥ 20 and all browsers.
   */
  fetch?: typeof fetch;
  /**
   * Per-request timeout in milliseconds. Default 15s.
   */
  timeoutMs?: number;
}

// Mirrors the actual /v1/audit/{id} response: { alert, evidence, evidence_status }.
// Pre-2026-05-29 the type was flat (receipt_sha256 at the top), but the API
// has always returned the nested shape — verifyAlert() silently returned
// `ok: false` for every call because `receipt.receipt_sha256` was undefined.
// See docs/operations/qa-pre-launch-workflow.md (B-012).
export interface AuditAlert {
  id: string;
  asset: string;
  class: string;
  from_state: string;
  to_state: string;
  discount: string;
  intrinsic_usd: string;
  market_usd: string;
  confidence: string;
  detected_at: string;
}

export interface AuditEvidence {
  methodology_version: string;
  methodology_git_sha?: string | null;
  assets_toml_sha256: string;
  commit_status?:
    | "not_applicable"
    | "pending"
    | "committed"
    | "retry_exhausted"
    | "wallet_drained";
  inputs_frozen?: Record<string, unknown>;
  computed?: Record<string, unknown>;
  has_replay_artifact: boolean;
  receipt_sha256: string;
  onchain_tx_sig?: string | null;
  created_at: string;
}

export interface AuditReceipt {
  alert: AuditAlert;
  evidence: AuditEvidence;
  evidence_status: "ready" | "pending" | "failed_permanent";
  [key: string]: unknown;
}

export interface AuditIndexRow {
  id: string;
  asset: string;
  from_state: string;
  to_state: string;
  detected_at: string;
  methodology_version: string;
  receipt_sha256: string;
  onchain_tx_sig: string | null;
}

// Mirrors the actual 200 body of /v1/audit/{id}/onchain:
// { tx_sig, explorer_url, commit_status }. On a 200 the alert is anchored, so
// `commit_status` is always "committed" and `tx_sig` is non-null (see
// crates/api-rs/src/routes/audit.rs onchain()). Every non-committed state —
// the COMMON case, since on-chain SPL Memo commits are cost-gated to
// {Depeg, Critical, BlackSwan} (ADR-0004) — returns 404, not a null tx_sig,
// so getOnchain() resolves to `null` rather than this shape (B-028: there is
// no `cluster`/`alert_id`/`memo_format` field on the live response).
export interface OnchainCommitment {
  tx_sig: string;
  explorer_url: string;
  commit_status: string;
}

export interface VerifyResult {
  /**
   * A DEFINITIVE verification verdict: `true` only when the receipt is `ready`
   * AND its sha matches `expected`. `false` means EITHER the receipt is ready
   * but its sha does not match (tampered / wrong expected) OR it isn't ready —
   * branch on `status` to tell those apart. It is NOT `false === tampered`.
   */
  ok: boolean;
  /** The receipt's materialization status; `ok` is only meaningful when `ready`. */
  status: AuditReceipt["evidence_status"];
  expected: string;
  actual: string;
  alert_id: string;
}

const DEFAULT_BASE = "https://api.pegana.xyz";
const DEFAULT_TIMEOUT = 15_000;

export class PeganaClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: PeganaClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  /**
   * GET /v1/audit/{id} — fetch the full receipt for an alert.
   */
  async getAudit(id: string): Promise<AuditReceipt> {
    return this.json<AuditReceipt>(`/v1/audit/${encodeURIComponent(id)}`);
  }

  /**
   * GET /v1/audit?limit=N — recent receipts, newest first.
   */
  async getAuditIndex(
    options: { limit?: number; excludePegged?: boolean } = {},
  ): Promise<AuditIndexRow[]> {
    const params = new URLSearchParams();
    if (options.limit != null) params.set("limit", String(options.limit));
    if (options.excludePegged != null) {
      params.set("exclude_pegged", String(options.excludePegged));
    }
    const qs = params.toString();
    return this.json<AuditIndexRow[]>(`/v1/audit${qs ? `?${qs}` : ""}`);
  }

  /**
   * GET /v1/audit/{id}/onchain — Solana SPL Memo commitment for the alert.
   *
   * Resolves to `null` when the alert is NOT anchored — which the route
   * reports as a 404 across every non-committed state (cost-gated /
   * not_applicable, in-flight, retry_exhausted, wallet_drained, unknown).
   * This is the COMMON case: SPL Memo commits are reserved for high-severity
   * transitions (ADR-0004). A non-null result means the anchor landed
   * (`commit_status === "committed"`, `tx_sig` present). Non-404 HTTP errors
   * still throw.
   */
  async getOnchain(id: string): Promise<OnchainCommitment | null> {
    return this.jsonOrNull<OnchainCommitment>(
      `/v1/audit/${encodeURIComponent(id)}/onchain`,
    );
  }

  /**
   * Verify an alert's stored receipt sha256 matches the expected value. This
   * is a lightweight client-side check — for cryptographic replay use the
   * pegana-replay CLI which re-executes the methodology end-to-end.
   */
  async verifyAlert(id: string, expectedSha: string): Promise<VerifyResult> {
    const receipt = await this.getAudit(id);
    const status = receipt.evidence_status;
    const actual = receipt.evidence?.receipt_sha256 ?? "";
    return {
      // Only a READY receipt can be verified. A pending/failed receipt has no
      // sha yet (actual === "") — returning ok:false there is NOT a mismatch;
      // callers distinguish it via `status` instead of mistaking it for tampering.
      ok: status === "ready" && actual !== "" && actual === expectedSha,
      status,
      expected: expectedSha,
      actual,
      alert_id: id,
    };
  }

  private async json<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(
          `Pegana API ${res.status} ${res.statusText} for ${path}`,
        );
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Like `json`, but treats a 404 as a soft "no resource yet" and resolves to
   * `null` instead of throwing. Used by `getOnchain`, where 404 is the route's
   * deliberate signal for every non-committed state (ADR-0004 / B-005).
   */
  private async jsonOrNull<T>(path: string): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(
          `Pegana API ${res.status} ${res.statusText} for ${path}`,
        );
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Module-level convenience functions backed by a default-configured client.
 * Useful for one-shot scripts; for production use, instantiate PeganaClient
 * explicitly so you can inject custom fetch / timeout.
 */
const defaultClient = new PeganaClient();
export const getAudit = (id: string) => defaultClient.getAudit(id);
export const getAuditIndex = (options?: {
  limit?: number;
  excludePegged?: boolean;
}) => defaultClient.getAuditIndex(options);
export const getOnchain = (id: string) => defaultClient.getOnchain(id);
export const verifyAlert = (id: string, expectedSha: string) =>
  defaultClient.verifyAlert(id, expectedSha);
