import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { LiveProvider, useLive } from "@/lib/store/live-context";

class MockWS {
  static instances: MockWS[] = [];
  onopen: unknown = null;
  onmessage: unknown = null;
  onclose: unknown = null;
  onerror: unknown = null;
  readyState = 0;
  send = vi.fn();
  close = vi.fn();
  constructor(public url: string) {
    MockWS.instances.push(this);
  }
}

function Consumer() {
  useLive();
  return null;
}

beforeEach(() => {
  MockWS.instances.length = 0;
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    MockWS as unknown as typeof WebSocket;
});

describe("LiveProvider", () => {
  it("opens exactly one socket for provider plus many consumers, closes it on unmount", () => {
    const { unmount } = render(
      <LiveProvider>
        <Consumer />
        <Consumer />
        <Consumer />
      </LiveProvider>,
    );
    expect(MockWS.instances.length).toBe(1);
    unmount();
    expect(MockWS.instances[0].close).toHaveBeenCalled();
    expect(MockWS.instances.length).toBe(1);
  });
});
