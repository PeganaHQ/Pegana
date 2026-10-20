import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWsClient } from "@/lib/api/ws";

class MockWS {
  static instances: MockWS[] = [];
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState = 0;
  send = vi.fn();
  close = vi.fn();
  constructor(public url: string) {
    MockWS.instances.push(this);
  }
}

beforeEach(() => {
  MockWS.instances.length = 0;
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    MockWS as unknown as typeof WebSocket;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createWsClient", () => {
  it("notifies on update messages", () => {
    const onUpdate = vi.fn();
    const client = createWsClient("ws://x", { onUpdate });
    client.connect();
    const sock = MockWS.instances[0];
    sock.onopen?.(new Event("open"));
    sock.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          op: "update",
          asset: "bSOL",
          payload: { state: "DRIFT" },
        }),
      }),
    );
    expect(onUpdate).toHaveBeenCalledWith("bSOL", { state: "DRIFT" });
  });

  it("reconnects with backoff after close", () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    const client = createWsClient("ws://x", {
      onUpdate,
      initialBackoffMs: 100,
    });
    client.connect();
    const sock = MockWS.instances[0];
    sock.onclose?.(new CloseEvent("close"));
    expect(MockWS.instances.length).toBe(1);
    vi.advanceTimersByTime(100);
    expect(MockWS.instances.length).toBe(2);
    client.disconnect();
  });

  it("flags stale and force-closes a silent (half-open) socket past the heartbeat timeout", () => {
    // A socket can stay 'open' while the engine has gone silent — onclose never
    // fires, so the dashboard keeps showing frozen green numbers. The watchdog
    // must notice the silence, signal it, and force a close so reconnect runs.
    vi.useFakeTimers();
    const onStale = vi.fn();
    const client = createWsClient("ws://x", {
      onUpdate: vi.fn(),
      onStale,
      heartbeatTimeoutMs: 1000,
    });
    client.connect();
    const sock = MockWS.instances[0];
    sock.onopen?.(new Event("open"));
    vi.advanceTimersByTime(1000);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(sock.close).toHaveBeenCalled();
    client.disconnect();
  });

  it("resets the staleness watchdog on every inbound message", () => {
    vi.useFakeTimers();
    const onStale = vi.fn();
    const client = createWsClient("ws://x", {
      onUpdate: vi.fn(),
      onStale,
      heartbeatTimeoutMs: 1000,
    });
    client.connect();
    const sock = MockWS.instances[0];
    sock.onopen?.(new Event("open"));
    vi.advanceTimersByTime(800);
    sock.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ op: "heartbeat", ts: "t" }),
      }),
    );
    vi.advanceTimersByTime(800); // 800ms since the heartbeat → still inside the window
    expect(onStale).not.toHaveBeenCalled();
    client.disconnect();
  });

  it("connect() is idempotent while a socket is live", () => {
    const client = createWsClient("ws://x", { onUpdate: vi.fn() });
    client.connect();
    MockWS.instances[0].readyState = 1;
    client.connect();
    expect(MockWS.instances.length).toBe(1);
    client.disconnect();
  });

  it("reconnect closes the previous socket and leaves exactly one live", () => {
    vi.useFakeTimers();
    const client = createWsClient("ws://x", {
      onUpdate: vi.fn(),
      initialBackoffMs: 100,
    });
    client.connect();
    const first = MockWS.instances[0];
    first.onclose?.(new CloseEvent("close"));
    vi.advanceTimersByTime(100);
    expect(MockWS.instances.length).toBe(2);
    expect(first.close).toHaveBeenCalled();
    // A late event from the retired socket must not schedule another reconnect.
    expect(first.onclose).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(MockWS.instances.length).toBe(2);
    client.disconnect();
    expect(MockWS.instances[1].close).toHaveBeenCalled();
  });
});
