/** Verify a Pegana webhook against active Ed25519 public keys. */
export interface VerifyWebhookOptions {
  headers: Headers | Record<string, string | undefined>;
  /** Exact raw request body; do not parse and reserialize it first. */
  body: string | Uint8Array;
  pubkeysB64: readonly string[];
  /** Unix seconds, injectable for tests. */
  nowSec?: number;
}

const EVENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function header(headers: VerifyWebhookOptions["headers"], name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return entry?.[1];
}

function decodeBase64(value: string): Uint8Array | undefined {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return undefined;
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function verifyWebhook(options: VerifyWebhookOptions): Promise<boolean> {
  const { headers, pubkeysB64 } = options;
  const timestamp = header(headers, "x-pegana-timestamp");
  const eventId = header(headers, "x-pegana-event-id");
  const v2 = header(headers, "x-pegana-signature-v2");
  const signature = v2 !== undefined ? v2 : header(headers, "x-pegana-signature");
  if (!timestamp || !/^\d+$/.test(timestamp) || !eventId || !EVENT_ID_RE.test(eventId) || !signature) {
    return false;
  }
  const ts = Number(timestamp);
  if (!Number.isSafeInteger(ts) || Math.abs((options.nowSec ?? Math.floor(Date.now() / 1000)) - ts) > 300) {
    return false;
  }
  let body: string;
  try {
    body = typeof options.body === "string"
      ? options.body
      : new TextDecoder("utf-8", { fatal: true }).decode(options.body);
    JSON.parse(body);
  } catch {
    return false;
  }
  if (!signature.startsWith("ed25519:")) return false;
  const signatureBytes = decodeBase64(signature.slice("ed25519:".length));
  if (signatureBytes?.length !== 64) return false;
  const message = new TextEncoder().encode(
    v2 !== undefined
      ? `pegana-webhook-v2.${timestamp}.${eventId}.${body}`
      : `${timestamp}.${body}`,
  );
  for (const pubkey of pubkeysB64) {
    const keyBytes = decodeBase64(pubkey);
    if (keyBytes?.length !== 32) continue;
    try {
      const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "Ed25519", false, ["verify"]);
      if (await crypto.subtle.verify("Ed25519", key, toArrayBuffer(signatureBytes), toArrayBuffer(message))) return true;
    } catch {
      // Continue through rotation keys, including malformed ones.
    }
  }
  return false;
}
