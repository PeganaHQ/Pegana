import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createTransitionRefresher,
  isTransitionKey,
} from "@/lib/store/live-context";

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

describe("transition-driven refresh", () => {
  it("targets only the stats, asset-list and receipts keys", () => {
    expect(isTransitionKey("stats")).toBe(true);
    expect(isTransitionKey("alerts|shared-60")).toBe(true);
    expect(isTransitionKey("alerts-window|x|10")).toBe(true);
    expect(isTransitionKey("assets||")).toBe(true);
    expect(isTransitionKey("assets|stable|")).toBe(true);
    expect(isTransitionKey("history|USDC|{}")).toBe(false);
    expect(isTransitionKey(["stats"])).toBe(false);
  });

  it("refreshes at most once a minute however many transitions arrive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    const refresh = vi.fn();
    const r = createTransitionRefresher(refresh, 60_000);
    r.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) {
      r.trigger();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    // 20s later: the burst collapsed into one pending trailing refresh.
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    r.cancel();
  });

  it("skips the refresh from a hidden tab", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    const refresh = vi.fn();
    const r = createTransitionRefresher(refresh, 60_000);
    r.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).not.toHaveBeenCalled();
  });
});
