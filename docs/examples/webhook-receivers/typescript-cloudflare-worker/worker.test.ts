import { describe, expect, it } from "bun:test";
import worker, { verifyWebhookSignature } from "./worker";

const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const VECTOR_BODY = '{"alert_id":"00000000-0000-4000-8000-000000000001","asset":"jitoSOL","to_state":"DEPEG"}';
const VECTOR_KEY = "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";
const VECTOR_V1 = "Gpu1U4olo6STeYr27K6qYvWl90VawFLzkF8vUNZzWCIuKmFwtHS3lNNWNbbHmQY3wM6Rupj1M1GFFaqSMpEiDw==";
const VECTOR_V2 = "EAiQCh9Cbfqho1Z8TV6s2TyyY9gMslfn756wqO5bVwOJl62yztsBBmMNJiVONK5PfUwkw+36XaYkPd7o+IsNBw==";

describe("webhook receiver dedup", () => {
  it("verifies both golden signatures and binds v2 to the event id", async () => {
    expect(await verifyWebhookSignature(`ed25519:${VECTOR_V2}`, "1700000000", EVENT_ID, VECTOR_BODY, [VECTOR_KEY], 2)).toBe(true);
    expect(await verifyWebhookSignature(`ed25519:${VECTOR_V1}`, "1700000000", EVENT_ID, VECTOR_BODY, [VECTOR_KEY], 1)).toBe(true);
    expect(await verifyWebhookSignature(`ed25519:${VECTOR_V2}`, "1700000000", "00000000-0000-4000-8000-000000000002", VECTOR_BODY, [VECTOR_KEY], 2)).toBe(false);
    expect(await verifyWebhookSignature(`ed25519:${VECTOR_V1}`, "1700000000", EVENT_ID, VECTOR_BODY, [VECTOR_KEY], 2)).toBe(false);
    expect(await verifyWebhookSignature(VECTOR_V2, "1700000000", EVENT_ID, VECTOR_BODY, [VECTOR_KEY], 2)).toBe(false);
    expect(await verifyWebhookSignature(`ed25519:${VECTOR_V2.slice(0, -2)}-_`, "1700000000", EVENT_ID, VECTOR_BODY, [VECTOR_KEY], 2)).toBe(false);
    expect(await verifyWebhookSignature(`ed25519:${VECTOR_V2}`, "1700000000.0", EVENT_ID, VECTOR_BODY, [VECTOR_KEY], 2)).toBe(false);
  });
  it("fails closed when the KV binding is missing", async () => {
    const response = await worker.fetch(new Request("https://receiver.test", { method: "POST" }), {} as never);
    expect(response.status).toBe(503);
  });

  it("marks a signed event only after parsing and processing", async () => {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    const pubB64 = btoa(String.fromCharCode(...publicKey));
    const seen = new Map<string, string>();
    let puts = 0;
    const kv = {
      get: async (key: string) => seen.get(key) ?? null,
      put: async (key: string, value: string) => { seen.set(key, value); puts++; },
    } as unknown as KVNamespace;
    const env = { PEGANA_PUB_KEY_B64: pubB64, PEGANA_DEDUP: kv };
    const ts = String(Math.floor(Date.now() / 1000));
    const send = async (body: string, mode: "v2" | "v1" | "invalid-v2" = "v2") => {
      const input = new TextEncoder().encode(
        mode === "v1" || mode === "invalid-v2"
          ? `${ts}.${body}`
          : `pegana-webhook-v2.${ts}.${EVENT_ID}.${body}`,
      );
      const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", keyPair.privateKey, input));
      const signature = `ed25519:${btoa(String.fromCharCode(...sig))}`;
      return worker.fetch(new Request("https://receiver.test", {
        method: "POST",
        headers: {
          "x-pegana-timestamp": ts,
          ...(mode === "v1" ? { "x-pegana-signature": signature } : {
            "x-pegana-signature": signature,
            "x-pegana-signature-v2": mode === "invalid-v2" ? "ed25519:invalid" : signature,
          }),
          "x-pegana-event-id": EVENT_ID,
        },
        body,
      }), env);
    };

    expect((await send("not json")).status).toBe(400);
    expect(seen.has(`seen:${EVENT_ID}`)).toBe(false);
    const body = JSON.stringify({
      alert_id: EVENT_ID, asset: "USDC", from_state: "PEGGED",
      to_state: "DRIFT", discount_bps: 10, ts,
    });
    expect((await send(body, "invalid-v2")).status).toBe(401);
    expect(seen.has(`seen:${EVENT_ID}`)).toBe(false);
    expect((await send(body)).status).toBe(200);
    expect(seen.get(`seen:${EVENT_ID}`)).toBe("1");
    expect((await send(body)).status).toBe(200);
    expect(puts).toBe(1);
    const secondBody = JSON.stringify({ ...JSON.parse(body), alert_id: "different" });
    expect((await send(secondBody, "v1")).status).toBe(200);
  });
});
