// Tests for the live peg-feed WebSocket helper (src/ws.ts). Unit tests inject a
// fake WebSocket (no network); a gated live test connects to the real
// wss://api.pegana.xyz/v1/ws and awaits a frame.

import { describe, expect, it } from "bun:test";
import {
  PegFeed,
  connectPegFeed,
  type PegFeedServerMsg,
  type WebSocketLike,
} from "../src/index.ts";

class FakeSocket {
  static instances: FakeSocket[] = [];
  sent: string[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.onclose?.({ code: 1000, reason: "bye" });
  }
}

const Fake = FakeSocket as unknown as WebSocketLike;

describe("PegFeed (unit, injected socket)", () => {
  it("connects to the url, subscribes on open, and routes update/heartbeat", () => {
    const updates: Array<[string, unknown]> = [];
    const heartbeats: string[] = [];
    const feed = new PegFeed({
      wsUrl: "wss://example.test/v1/ws",
      WebSocketImpl: Fake,
      assets: ["USDC", "JLP"],
      onUpdate: (a, p) => updates.push([a, p]),
      onHeartbeat: (ts) => heartbeats.push(ts),
    });
    const sock = FakeSocket.instances.at(-1)!;
    expect(sock.url).toBe("wss://example.test/v1/ws");

    sock.onopen?.({});
    expect(JSON.parse(sock.sent[0]!)).toEqual({
      op: "subscribe",
      assets: ["USDC", "JLP"],
    });

    sock.onmessage?.({
      data: JSON.stringify({
        op: "update",
        asset: "USDC",
        payload: { discount: "0.001" },
      }),
    });
    expect(updates).toEqual([["USDC", { discount: "0.001" }]]);

    sock.onmessage?.({
      data: JSON.stringify({ op: "heartbeat", ts: "2026-07-26T00:00:00Z" }),
    });
    expect(heartbeats).toEqual(["2026-07-26T00:00:00Z"]);

    feed.subscribe(["USDe"]);
    feed.ping();
    feed.unsubscribe(["JLP"]);
    expect(JSON.parse(sock.sent.at(-3)!)).toEqual({ op: "subscribe", assets: ["USDe"] });
    expect(JSON.parse(sock.sent.at(-2)!)).toEqual({ op: "ping" });
    expect(JSON.parse(sock.sent.at(-1)!)).toEqual({ op: "unsubscribe", assets: ["JLP"] });

    feed.close();
    expect(sock.closed).toBe(true);
  });

  it("routes a malformed frame to onError instead of throwing", () => {
    let err: unknown;
    new PegFeed({ WebSocketImpl: Fake, onError: (e) => (err = e) });
    const sock = FakeSocket.instances.at(-1)!;
    sock.onmessage?.({ data: "not json {" });
    expect(err).toBeDefined();
  });

  it("throws a clear error when no WebSocket implementation is available", () => {
    const g = globalThis as { WebSocket?: unknown };
    const saved = g.WebSocket;
    g.WebSocket = undefined; // simulate Node <=21 with none injected
    try {
      expect(() => new PegFeed({})).toThrow(/WebSocket implementation/);
    } finally {
      g.WebSocket = saved;
    }
  });
});

describe("live peg feed (PEGANA_SDK_LIVE=1)", () => {
  it.skipIf(process.env.PEGANA_SDK_LIVE !== "1")(
    "receives a frame from wss://api.pegana.xyz/v1/ws (heartbeat/update/pong)",
    async () => {
      const got = await new Promise<PegFeedServerMsg>((resolve, reject) => {
        const feed = connectPegFeed({
          onMessage: (m) => {
            feed.close();
            resolve(m);
          },
          onError: (e) => reject(e),
        });
        // The engine heartbeats every few seconds, so a frame should arrive fast.
        setTimeout(() => {
          feed.close();
          reject(new Error("no frame within 15s"));
        }, 15000);
      });
      expect(["update", "heartbeat", "pong"]).toContain(got.op);
    },
  );
});
