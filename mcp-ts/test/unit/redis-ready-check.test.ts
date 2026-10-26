import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture every ioredis constructor call and fake the subscribe/message flow,
// so the test proves (a) no connection is built without enableReadyCheck:false
// and (b) the subscription path still delivers messages.
const made: Array<{ url: unknown; options: unknown }> = [];
const handlers = new Map<string, Array<(channel: string, msg: string) => void>>();

vi.mock("ioredis", () => ({
  default: class FakeRedis {
    constructor(url: unknown, options: unknown) {
      made.push({ url, options });
    }
    async subscribe() {
      return 1;
    }
    on(event: string, fn: (channel: string, msg: string) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);
    }
    async unsubscribe() {}
    disconnect() {}
  },
}));

beforeEach(() => {
  made.length = 0;
  handlers.clear();
  vi.resetModules();
});

describe("redis clients", () => {
  it("builds the query client, the cache subscriber and alert subscriptions without the INFO ready check", async () => {
    const r = await import("@/redis");
    r.client();
    await r.startCacheWarming();
    await r.subscribeAlerts(() => {});
    expect(made).toHaveLength(3);
    for (const m of made) expect(m.options).toMatchObject({ enableReadyCheck: false });
  });

  it("the cache subscription still receives discount snapshots", async () => {
    const r = await import("@/redis");
    await r.startCacheWarming();
    const snap = {
      kind: "update",
      asset: "USDC",
      state: "PEGGED",
      discount: "0.0001",
      intrinsic_usd: "1",
      market_usd: "1",
      ts: Math.floor(Date.now() / 1000),
      updated_at: new Date().toISOString(),
    };
    for (const fn of handlers.get("message") ?? []) fn("pegana:discount", JSON.stringify(snap));
    expect(r.getCachedState("USDC")?.state).toBe("PEGGED");
  });
});
