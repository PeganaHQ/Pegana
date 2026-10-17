/**
 * Pegana webhook receiver — Cloudflare Worker reference.
 *
 * Verifies an Ed25519 signature on `<x-pegana-timestamp>.<body>`
 * using the Web Crypto API (Ed25519 is supported natively in
 * Workers since 2023 via the Secure Curves spec).
 *
 * Replay protection: rejects anything outside a 5-minute window.
 *
 * Idempotency: Pegana retries up to 6 times with [5s, 30s, 5m, 30m, 2h]
 * backoff on non-2xx / network error. Every attempt carries the same
 * `x-pegana-event-id` (= `alert_id` in body); dedupe on that header
 * with a KV TTL of ~24h so a slow primary handler doesn't process the
 * same alert twice. Receiver-side dedup is the authoritative path —
 * Pegana never relies on at-most-once delivery.
 *
 * Headers you can rely on:
 *   x-pegana-signature      ed25519:<base64 sig>
 *   x-pegana-timestamp      unix seconds (signed input is `<ts>.<body>`)
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

interface Env {
  /** Optional override — comma-separated base64 pubkeys, primary first.
   *  Set via `wrangler secret put PEGANA_PUB_KEY_B64`. */
  PEGANA_PUB_KEY_B64?: string;
  /** Optional KV namespace for cross-attempt dedup + cached pubkeys.
   *  Bind in wrangler.toml. */
  PEGANA_DEDUP?: KVNamespace;
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
  if (env.PEGANA_DEDUP) {
    const raw = await env.PEGANA_DEDUP.get("pegana:webhook-keys");
    if (raw) {
      const cached = JSON.parse(raw) as CachedKeys;
      if (nowSec - cached.fetched_at < KEYS_TTL_SEC && cached.pubkeys_b64.length) {
        return cached.pubkeys_b64;
      }
    }
  }
  try {
    const res = await fetch(PEGANA_KEYS_URL, { cf: { cacheTtl: KEYS_TTL_SEC } });
    if (res.ok) {
      const body = (await res.json()) as { pubkeys_b64?: string[] };
      const fresh = body.pubkeys_b64 ?? [];
      if (fresh.length && env.PEGANA_DEDUP) {
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("POST only", { status: 405 });
    }
    const sigHeader = req.headers.get("x-pegana-signature");
    const ts = req.headers.get("x-pegana-timestamp");
    if (!sigHeader || !ts) {
      return new Response("missing signature headers", { status: 401 });
    }

    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) {
      return new Response("bad timestamp", { status: 401 });
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - tsNum) > REPLAY_WINDOW_SEC) {
      return new Response("stale", { status: 401 });
    }

    const sigB64 = sigHeader.replace(/^ed25519:/, "");
    const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    if (sigBytes.length !== 64) {
      return new Response("bad signature length", { status: 401 });
    }

    const body = await req.text();
    const input = new TextEncoder().encode(`${ts}.${body}`);

    // Try each active pubkey. During a rotation window /v1/meta/webhook-keys
    // returns [primary, secondary]; either signature is acceptable.
    const pubkeys = await resolvePubkeys(env);
    let ok = false;
    for (const pubB64 of pubkeys) {
      const pubBytes = Uint8Array.from(atob(pubB64), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey(
        "raw",
        pubBytes,
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      if (await crypto.subtle.verify("Ed25519", key, sigBytes, input)) {
        ok = true;
        break;
      }
    }
    if (!ok) return new Response("bad signature", { status: 401 });

    // Dedup at the header level — every attempt of the same alert carries
    // the same x-pegana-event-id (= body.alert_id). Skip business logic if
    // we've already processed this event within the TTL window. Return
    // 200 so Pegana stops retrying.
    const eventId = req.headers.get("x-pegana-event-id");
    const attempt = req.headers.get("x-pegana-attempt") ?? "?";
    if (eventId && env.PEGANA_DEDUP) {
      const seen = await env.PEGANA_DEDUP.get(`seen:${eventId}`);
      if (seen) {
        console.log(`dedup hit event=${eventId} attempt=${attempt}`);
        return new Response("duplicate ignored", { status: 200 });
      }
      await env.PEGANA_DEDUP.put(`seen:${eventId}`, "1", {
        expirationTtl: DEDUP_TTL_SEC,
      });
    }

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

    // Your business logic here. Examples:
    //   await fetch(SLACK_WEBHOOK, { method: "POST", body: JSON.stringify({ text: `${event.asset} → ${event.to_state}` }) });
    console.log(`verified event=${eventId} attempt=${attempt}`, event);

    return new Response("ok");
  },
};
