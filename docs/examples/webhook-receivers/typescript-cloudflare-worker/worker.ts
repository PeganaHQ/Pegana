/**
 * Pegana webhook receiver — Cloudflare Worker reference.
 *
 * Verifies an Ed25519 signature on
 * `pegana-webhook-v2.<timestamp>.<event-id>.<raw body>` when v2 is present,
 * with the legacy `<timestamp>.<raw body>` format only when v2 is absent.
 * using the Web Crypto API (Ed25519 is supported natively in
 * Workers since 2023 via the Secure Curves spec).
 *
 * Replay protection: rejects anything outside a 5-minute window.
 *
 * Idempotency: Pegana retries up to 6 times with [5s, 30s, 5m, 30m, 2h]
 * backoff on non-2xx / network error. Every attempt carries the same
 * `x-pegana-event-id`; dedupe on that header
 * with a KV TTL of ~24h after successful processing. Receiver-side dedup is the authoritative path —
 * Pegana never relies on at-most-once delivery.
 *
 * Headers you can rely on:
 *   x-pegana-signature      ed25519:<base64 sig>
 *   x-pegana-signature-v2   ed25519:<base64 sig> (preferred; covers event id)
 *   x-pegana-timestamp      unix seconds
 *   x-pegana-event-id       stable across retries — use for dedup
 *   x-pegana-delivery-id    fresh per attempt — use for log correlation
 *   x-pegana-attempt        "<n>/<max>" — page on n == max-1
 */

// Authoritative trust source: https://api.pegana.xyz/v1/meta/webhook-keys.
// Returns `{ pubkeys_b64: [primary, secondary?] }` so during a rotation
// window both keys are temporarily live. This worker tries each one in
// order; either valid signature passes. For zero-network-dependency
// startup it also accepts a baked-in default + a wrangler secret
// override (CSV — `primary,secondary`).
const DEFAULT_PEGANA_PUB_KEYS_B64 = "gAKAhNG4BLCF0xm/gCcDb0OcP6cxzt1IfXkmkzyVYVo=";
const PEGANA_KEYS_URL = "https://api.pegana.xyz/v1/meta/webhook-keys";
const KEYS_TTL_SEC = 3_600; // refresh hourly; rotation windows are days long.
const REPLAY_WINDOW_SEC = 300;
const DEDUP_TTL_SEC = 86_400; // 24h covers the full ~2h35m retry envelope ×10.
const EVENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Env {
  /** Optional override — comma-separated base64 pubkeys, primary first.
   *  Set via `wrangler secret put PEGANA_PUB_KEY_B64`. */
  PEGANA_PUB_KEY_B64?: string;
  /** Required KV namespace for cross-attempt dedup + cached pubkeys. */
  PEGANA_DEDUP: KVNamespace;
}

interface CachedKeys {
  pubkeys_b64: string[];
  fetched_at: number;
}

/**
 * Resolve the active public-key list, in priority order:
 *   1. `PEGANA_PUB_KEY_B64` env override (CSV).
 *   2. KV cache `pegana:webhook-keys` if younger than KEYS_TTL_SEC.
 *   3. Live fetch from /v1/meta/webhook-keys (then cached if KV is bound).
 *   4. Hard-coded fallback so a transient api.pegana.xyz outage doesn't
 *      reject every webhook in flight.
 */
async function resolvePubkeys(env: Env): Promise<string[]> {
  if (env.PEGANA_PUB_KEY_B64) {
    return env.PEGANA_PUB_KEY_B64.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const raw = await env.PEGANA_DEDUP.get("pegana:webhook-keys");
  if (raw) {
    const cached = JSON.parse(raw) as CachedKeys;
    if (nowSec - cached.fetched_at < KEYS_TTL_SEC && cached.pubkeys_b64.length) {
      return cached.pubkeys_b64;
    }
  }
  try {
    const res = await fetch(PEGANA_KEYS_URL, { cf: { cacheTtl: KEYS_TTL_SEC } });
    if (res.ok) {
      const body = (await res.json()) as { pubkeys_b64?: string[] };
      const fresh = body.pubkeys_b64 ?? [];
      if (fresh.length) {
        await env.PEGANA_DEDUP.put(
          "pegana:webhook-keys",
          JSON.stringify({ pubkeys_b64: fresh, fetched_at: nowSec } as CachedKeys),
          { expirationTtl: KEYS_TTL_SEC * 2 },
        );
      }
      if (fresh.length) return fresh;
    }
  } catch (e) {
    console.warn("pegana keys fetch failed; using fallback", e);
  }
  return DEFAULT_PEGANA_PUB_KEYS_B64.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Verify one signature against the active keys; the caller selects v2 first. */
export async function verifyWebhookSignature(
  signature: string,
  timestamp: string,
  eventId: string,
  body: string,
  pubkeys: string[],
  version: 1 | 2,
): Promise<boolean> {
  if (!/^\d+$/.test(timestamp) || !signature.startsWith("ed25519:")) return false;
  const base64 = signature.slice("ed25519:".length);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) return false;
  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  if (sigBytes.length !== 64) return false;
  const input = new TextEncoder().encode(
    version === 2
      ? `pegana-webhook-v2.${timestamp}.${eventId}.${body}`
      : `${timestamp}.${body}`,
  );
  for (const pubB64 of pubkeys) {
    try {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(pubB64)) continue;
      const pubBytes = Uint8Array.from(atob(pubB64), (c) => c.charCodeAt(0));
      if (pubBytes.length !== 32) continue;
      const key = await crypto.subtle.importKey("raw", pubBytes, { name: "Ed25519" }, false, ["verify"]);
      if (await crypto.subtle.verify("Ed25519", key, sigBytes, input)) return true;
    } catch {
      // A malformed rotation key must not prevent trying the next key.
    }
  }
  return false;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("POST only", { status: 405 });
    }
    if (!env.PEGANA_DEDUP) {
      console.error("PEGANA_DEDUP KV binding is required");
      return new Response("receiver unavailable", { status: 503 });
    }
    const v2 = req.headers.get("x-pegana-signature-v2");
    const sigHeader = v2 ?? req.headers.get("x-pegana-signature");
    const ts = req.headers.get("x-pegana-timestamp");
    const eventId = req.headers.get("x-pegana-event-id");
    if (!sigHeader || !ts || !eventId || !EVENT_ID_RE.test(eventId)) {
      return new Response("missing signature headers", { status: 401 });
    }

    const tsNum = Number(ts);
    if (!/^\d+$/.test(ts) || !Number.isSafeInteger(tsNum)) {
      return new Response("bad timestamp", { status: 401 });
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - tsNum) > REPLAY_WINDOW_SEC) {
      return new Response("stale", { status: 401 });
    }

    const body = await req.text();

    // Try each active pubkey. During a rotation window /v1/meta/webhook-keys
    // returns [primary, secondary]; either signature is acceptable.
    const pubkeys = await resolvePubkeys(env);
    const ok = await verifyWebhookSignature(sigHeader, ts, eventId, body, pubkeys, v2 === null ? 1 : 2);
    if (!ok) return new Response("bad signature", { status: 401 });

    const attempt = req.headers.get("x-pegana-attempt") ?? "?";

    let event: {
      asset: string;
      from_state: string;
      to_state: string;
      discount_bps: number;
      ts: string;
      alert_id: string;
    };
    try {
      event = JSON.parse(body) as typeof event;
    } catch {
      return new Response("invalid JSON body", { status: 400 });
    }
    const seen = await env.PEGANA_DEDUP.get(`seen:${eventId}`);
    if (seen) {
      console.log(`dedup hit event=${eventId} attempt=${attempt}`);
      return new Response("duplicate ignored", { status: 200 });
    }

    // Your business logic here. Examples:
    //   await fetch(SLACK_WEBHOOK, { method: "POST", body: JSON.stringify({ text: `${event.asset} → ${event.to_state}` }) });
    console.log(`verified event=${eventId} attempt=${attempt}`, event);
    // Record completion only after business logic succeeds, so a failed
    // delivery remains retryable.
    await env.PEGANA_DEDUP.put(`seen:${eventId}`, "1", {
      expirationTtl: DEDUP_TTL_SEC,
    });

    return new Response("ok");
  },
};
