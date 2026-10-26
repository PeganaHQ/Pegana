import { describe, expect, it } from "vitest";
import { verifyWebhook } from "../src/index.ts";

const body = '{"alert_id":"00000000-0000-4000-8000-000000000001","asset":"jitoSOL","to_state":"DEPEG"}';
const eventId = "00000000-0000-4000-8000-000000000001";
const pubkey = "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";
const v1 = "Gpu1U4olo6STeYr27K6qYvWl90VawFLzkF8vUNZzWCIuKmFwtHS3lNNWNbbHmQY3wM6Rupj1M1GFFaqSMpEiDw==";
const v2 = "EAiQCh9Cbfqho1Z8TV6s2TyyY9gMslfn756wqO5bVwOJl62yztsBBmMNJiVONK5PfUwkw+36XaYkPd7o+IsNBw==";
const headers = {
  "x-pegana-timestamp": "1700000000",
  "x-pegana-event-id": eventId,
  "x-pegana-signature": `ed25519:${v1}`,
  "x-pegana-signature-v2": `ed25519:${v2}`,
};

describe("verifyWebhook", () => {
  it("accepts the v2 golden vector and the v1 legacy vector", async () => {
    expect(await verifyWebhook({ headers, body, pubkeysB64: [pubkey], nowSec: 1700000000 })).toBe(true);
    const legacy = { ...headers };
    Reflect.deleteProperty(legacy, "x-pegana-signature-v2");
    expect(await verifyWebhook({ headers: legacy, body: new TextEncoder().encode(body), pubkeysB64: [pubkey], nowSec: 1700000000 })).toBe(true);
  });

  it("requires v2 when present and binds the event id and body", async () => {
    expect(await verifyWebhook({ headers: { ...headers, "x-pegana-signature-v2": "bad" }, body, pubkeysB64: [pubkey], nowSec: 1700000000 })).toBe(false);
    expect(await verifyWebhook({ headers: { ...headers, "x-pegana-event-id": "00000000-0000-4000-8000-000000000002" }, body, pubkeysB64: [pubkey], nowSec: 1700000000 })).toBe(false);
    expect(await verifyWebhook({ headers, body: body + " ", pubkeysB64: [pubkey], nowSec: 1700000000 })).toBe(false);
    expect(await verifyWebhook({ headers, body, pubkeysB64: [pubkey], nowSec: 1700000301 })).toBe(false);
    expect(await verifyWebhook({ headers: { ...headers, "x-pegana-signature-v2": v2 }, body, pubkeysB64: [pubkey], nowSec: 1700000000 })).toBe(false);
    expect(await verifyWebhook({ headers: { ...headers, "x-pegana-signature-v2": `ed25519:${v2.slice(0, -2)}-_` }, body, pubkeysB64: [pubkey], nowSec: 1700000000 })).toBe(false);
  });
});
