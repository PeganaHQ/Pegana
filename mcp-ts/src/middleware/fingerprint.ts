// Agent fingerprint extraction for ADR-0011 telemetry + rate limiting.
//
// Two paths:
//   1. Paid tools: x402 sets the `X-PAYMENT` request header carrying a
//      base64-encoded JSON envelope. The envelope's inner SVM payload
//      contains a base64 Solana wire transaction whose `staticAccounts`
//      list is stable per-payer (and varies between distinct payers),
//      while the rest of the envelope (signature bytes, recent blockhash)
//      is per-payment random. We decode and hash JUST the static account
//      list so two payments from the same wallet collapse to the same
//      fingerprint — closing the rate-limit bypass that resulted from
//      hashing the full nonce-bearing envelope.
//   2. Free tools / no payment: fall back to the originating IP. Caddy
//      sets `X-Forwarded-For` in prod (api-rs/src/rate_limit.rs trusts
//      the same header); local dev has no proxy so we fall further to
//      `X-Real-IP` and finally to `anonymous`.
//
// Why a hash instead of the raw IP / payer address:
//   * mcp_call_log stores fingerprints; we don't want to log raw IPs
//     (privacy) or raw on-chain addresses (publicly linkable to wallets).
//   * Stable, short identifier across calls from the same agent.
//
// The hash is keyed by a process-local salt so two operators reading
// the same log can't trivially correlate fingerprints — call-log rows
// are operator-only data, not a public namespace.

import { createHash, randomBytes } from "node:crypto";
import type { IsomorphicHeaders } from "@modelcontextprotocol/sdk/types.js";
import {
  getBase64Encoder,
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
} from "@solana/kit";

// Process-local salt, generated once at module load. Restarts rotate
// the salt — fine, because fingerprints only need to be stable within
// a single rate-limit window (60s).
const SALT = randomBytes(16).toString("hex");

function headerValue(
  headers: IsomorphicHeaders | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  // Headers are case-insensitive per RFC; the MCP SDK preserves the
  // original casing as written by the HTTP transport. Probe lowercase
  // first (Node's http2 + Bun normalize) then the canonical form.
  const lower = headers[name.toLowerCase()];
  const exact = headers[name];
  const raw = lower ?? exact;
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

function firstIpFromXff(xff: string): string {
  // X-Forwarded-For is a comma-separated list, originating client first.
  const first = xff.split(",")[0]?.trim();
  return first ?? xff;
}

/**
 * Decode a base64 string into bytes using @solana/kit's encoder. Returns
 * undefined on any decoder error — callers fall back to other fingerprint
 * sources rather than failing the request.
 */
function decodeBase64(input: string): Uint8Array | undefined {
  try {
    return getBase64Encoder().encode(input) as Uint8Array;
  } catch {
    return undefined;
  }
}

/**
 * Pull the stable per-payer identifier out of an x402 payment envelope.
 *
 * The envelope is the base64-encoded JSON payload x402 ships in the
 * `X-PAYMENT` HTTP header (or `_meta["x402/payment"]` JSON-RPC field for
 * the createPaymentWrapper path). Shape (see @x402/core types):
 *
 *   { x402Version: 1, scheme: "exact", network: "solana", payload: {
 *       transaction: "<base64 wire tx>"
 *   } }
 *
 * For SVM exact scheme, the wire transaction's compiled-message
 * `staticAccounts` array lists every account participating in the
 * payment (payer wallet, payer token account, receiver token account,
 * token program, fee payer, …). It is identical across two payments
 * from the same payer to the same receiver; only the recent blockhash
 * and the signatures vary.
 *
 * Returns `undefined` if we can't recover a stable identifier — callers
 * fall back to the full envelope hash as a fail-closed bucket so the
 * rate-limit can't be bypassed by feeding a deliberately undecodable
 * payload.
 */
function payerKeyFromPaymentEnvelope(envelope: string): string | undefined {
  const envBytes = decodeBase64(envelope);
  if (!envBytes) return undefined;
  let envJson: unknown;
  try {
    envJson = JSON.parse(new TextDecoder().decode(envBytes));
  } catch {
    return undefined;
  }
  if (!envJson || typeof envJson !== "object") return undefined;
  const payload = (envJson as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return undefined;
  const txB64 = (payload as { transaction?: unknown }).transaction;
  if (typeof txB64 !== "string") return undefined;

  const txBytes = decodeBase64(txB64);
  if (!txBytes) return undefined;
  try {
    const tx = getTransactionDecoder().decode(txBytes);
    const compiled = getCompiledTransactionMessageDecoder().decode(
      tx.messageBytes,
    );
    const accounts = compiled.staticAccounts ?? [];
    if (accounts.length === 0) return undefined;
    // Concatenate addresses with a delimiter so two payments from the
    // same payer to the same receiver collapse to the same key, but two
    // different payers (or two different receivers) get distinct keys.
    return accounts.map((a) => a.toString()).join("|");
  } catch {
    return undefined;
  }
}

/**
 * Derive a stable, short fingerprint for an MCP caller. Returns
 * `undefined` if the request carries no identifying header at all
 * (true anonymous — should be rare; transports always set at least
 * a peer address).
 */
export function extractFingerprint(
  headers: IsomorphicHeaders | undefined,
): string | undefined {
  // Paid path first: an x402 `X-PAYMENT` payload is the strongest signal
  // because it identifies the on-chain payer.
  const payment = headerValue(headers, "x-payment");
  if (payment) {
    const payerKey = payerKeyFromPaymentEnvelope(payment);
    // Fall back to a hash of the full envelope if decode fails so a
    // deliberately-malformed payment can't bypass the rate-limit — but
    // tag it so we can distinguish in logs.
    return payerKey
      ? hash(`payer:${payerKey}`)
      : hash(`payment-undecoded:${payment}`);
  }

  // Free / unauthenticated path: lean on the originating IP.
  const xff = headerValue(headers, "x-forwarded-for");
  if (xff) {
    return hash(`ip:${firstIpFromXff(xff)}`);
  }
  const realIp = headerValue(headers, "x-real-ip");
  if (realIp) {
    return hash(`ip:${realIp}`);
  }

  return undefined;
}

/**
 * Derive a fingerprint from the JSON-RPC `_meta` payload. Used for
 * x402-paid tools, where the createPaymentWrapper replaces the SDK's
 * RequestHandlerExtra with an internal context that drops
 * `requestInfo.headers`. The `x402/payment` meta key carries the same
 * envelope as the X-PAYMENT header (string or pre-decoded JSON).
 */
export function fingerprintFromMeta(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  if (!meta) return undefined;
  const payment = meta["x402/payment"];
  if (payment === undefined) return undefined;
  // If the wrapper already decoded the JSON envelope, re-serialize then
  // base64 so payerKeyFromPaymentEnvelope sees a uniform input shape.
  const serialized =
    typeof payment === "string"
      ? payment
      : Buffer.from(JSON.stringify(payment), "utf8").toString("base64");
  const payerKey = payerKeyFromPaymentEnvelope(serialized);
  return payerKey
    ? hash(`payer:${payerKey}`)
    : hash(`payment-undecoded:${serialized}`);
}

function hash(input: string): string {
  return createHash("sha256")
    .update(SALT)
    .update(":")
    .update(input)
    .digest("hex")
    .slice(0, 16); // 16 hex chars = 64 bits — plenty for in-memory bucketing.
}
