import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

// Live socket state is driven per test.
const live = { available: true, connected: false, wsDrivenPage: false, byAsset: {} };
vi.mock("@/lib/store/live-context", () => ({
  useLive: () => live,
}));

import { api, ApiError } from "@/lib/api/client";
import {
  __resetFreshnessForTests,
  getFreshnessSnapshot,
  isLiveUpdatesPaused,
  noteRateLimited,
  rateLimitWaitMs,
  recordApiFailure,
  recordApiSuccess,
} from "@/lib/api/freshness";
import { errorRetryDelayMs } from "@/lib/api/swr-retry";
import { pollIntervalMs } from "@/lib/api/poll-policy";
import { useStats } from "@/lib/hooks/use-stats";
import { HealthBanner } from "@/components/molecules/health-banner";

const FORBIDDEN = /rate.?limit|requests a minute|per IP|429|\b60\b|too many/i;

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function tooMany(retryAfter = "30") {
  return new Response("{}", { status: 429, headers: { "retry-after": retryAfter } });
}

function freshSwr({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        shouldRetryOnError: false,
        revalidateOnFocus: false,
      }}
    >
      {children}
    </SWRConfig>
  );
}

beforeEach(() => {
  live.available = true;
  live.connected = false;
  live.wsDrivenPage = false;
  __resetFreshnessForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

describe("429 backoff", () => {
  it("follows the real API schedule: Retry-After 60 gives 60/60/60/120/240/300s", () => {
    const now = 1_000_000;
    const waits = Array.from({ length: 7 }, () =>
      noteRateLimited(60, now, () => 0),
    );
    // blockedUntil only moves forward, so read each step's own wait.
    expect(waits.slice(0, 6)).toEqual([
      60_000, 60_000, 60_000, 120_000, 240_000, 300_000,
    ]);
    expect(waits[6]).toBe(300_000);
  });

  it("honours Retry-After, then grows exponentially on repeated 429s", () => {
    const now = 1_000_000;
    const noJitter = () => 0;
    // Retry-After 45s beats the 15s exponential floor.
    expect(noteRateLimited(45, now, noJitter)).toBe(45_000);
    __resetFreshnessForTests(now);
    // A short Retry-After still waits the exponential floor: 15s, 30s, 60s.
    expect(noteRateLimited(5, now, noJitter)).toBe(15_000);
    expect(noteRateLimited(5, now, noJitter)).toBe(30_000);
    expect(noteRateLimited(5, now, noJitter)).toBe(60_000);
  });

  it("caps a single wait at 5 minutes and adds bounded jitter", () => {
    const now = 1_000_000;
    for (let i = 0; i < 12; i++) noteRateLimited(1, now, () => 0);
    expect(rateLimitWaitMs(now)).toBe(300_000);
    __resetFreshnessForTests(now);
    // Max jitter is 20% of the wait, at most 5s.
    expect(noteRateLimited(10, now, () => 0.999)).toBe(15_000 + 2_997);
  });

  it("falls back to a full minute when Retry-After is missing", () => {
    expect(noteRateLimited(undefined, 0, () => 0)).toBe(60_000);
  });

  it("a success clears the wait and the streak", () => {
    noteRateLimited(30, Date.now(), () => 0);
    recordApiSuccess();
    expect(rateLimitWaitMs()).toBe(0);
    expect(noteRateLimited(5, Date.now(), () => 0)).toBe(15_000);
  });

  it("while the wait is open, requests fail locally without touching the network", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    const fetchMock = vi.fn(async () => tooMany("30"));
    vi.stubGlobal("fetch", fetchMock);

    const first = await api.stats().catch((e) => e);
    expect(first).toBeInstanceOf(ApiError);
    expect(first.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Every other hook on the page hitting the API inside the window.
    for (let i = 0; i < 5; i++) {
      const e = await api.assets().catch((x) => x);
      expect(e.status).toBe(429);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // After Retry-After (+ max jitter) the next request goes out again.
    fetchMock.mockImplementation(async () => okJson({ ok: true }));
    vi.setSystemTime(new Date("2026-10-21T12:00:37Z"));
    await api.stats();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getFreshnessSnapshot().failureKind).toBeNull();
  });

  it("SWR retries no sooner than the tab-wide wait", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const err = new ApiError("x", "/v1/stats", 429, 10);
    expect(errorRetryDelayMs(err, 1, 90_000)).toBe(90_000);
    expect(errorRetryDelayMs(err, 1, 0)).toBe(10_000);
  });
});

describe("last good data on a 429", () => {
  it("keeps the previous stats on screen when a refresh is refused", async () => {
    const stats = { total_assets: 42 };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => okJson(stats))
      .mockImplementation(async () => tooMany("30"));
    vi.stubGlobal("fetch", fetchMock);

    // Read data and error during render: SWR only re-renders for the fields
    // a component actually reads.
    const { result } = renderHook(
      () => {
        const s = useStats();
        return { swr: { data: s.data, error: s.error, mutate: s.mutate } };
      },
      { wrapper: freshSwr },
    );
    await waitFor(() => expect(result.current.swr.data).toEqual(stats));

    await act(async () => {
      await result.current.swr.mutate();
    });
    await waitFor(() => expect(result.current.swr.error).toBeTruthy());
    expect((result.current.swr.error as ApiError).status).toBe(429);
    expect(result.current.swr.data).toEqual(stats);
  });
});

describe("no rate-limit text is ever rendered", () => {
  it("shows nothing for the first 60s of a 429", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    __resetFreshnessForTests();
    recordApiSuccess();
    noteRateLimited(30);
    vi.setSystemTime(new Date("2026-10-21T12:00:45Z"));
    const { container } = render(<HealthBanner />);
    expect(container.textContent).toBe("");
  });

  it("after 60s without a refresh, shows one calm line and no Retry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    __resetFreshnessForTests();
    recordApiSuccess();
    noteRateLimited(30);
    vi.setSystemTime(new Date("2026-10-21T12:01:30Z"));
    const { container, queryByRole } = render(<HealthBanner />);
    expect(container.textContent).toContain(
      "Live updates paused, resuming shortly.",
    );
    expect(container.textContent).not.toMatch(FORBIDDEN);
    expect(queryByRole("button")).toBeNull();
    expect(queryByRole("alert")).toBeNull();
  });

  it("stays silent on a 429 while the socket streams to a page that renders it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    __resetFreshnessForTests();
    noteRateLimited(30);
    vi.setSystemTime(new Date("2026-10-21T12:05:00Z"));
    live.connected = true;
    live.wsDrivenPage = true;
    const { container } = render(<HealthBanner />);
    expect(container.textContent).toBe("");
  });

  it("still shows the line on a page that reads nothing from the socket", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    __resetFreshnessForTests();
    noteRateLimited(30);
    vi.setSystemTime(new Date("2026-10-21T12:05:00Z"));
    live.connected = true;
    live.wsDrivenPage = false;
    const { container } = render(<HealthBanner />);
    expect(container.textContent).toContain(
      "Live updates paused, resuming shortly.",
    );
  });

  it("words a long outage calmly, without status codes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    __resetFreshnessForTests();
    recordApiFailure("server");
    vi.setSystemTime(new Date("2026-10-21T12:02:00Z"));
    const { container } = render(<HealthBanner />);
    expect(container.textContent).toContain("Live updates paused.");
    expect(container.textContent).not.toMatch(/\b5\d\d\b|API|unreachable/);
    expect(container.textContent).not.toMatch(FORBIDDEN);
  });

  it("counts the 60s from the FIRST failure, not the last success (WS up, 120s polls)", () => {
    const t0 = 1_000_000;
    __resetFreshnessForTests(t0);
    recordApiSuccess(t0);
    // Socket up: the next stats poll is 120s later, and it gets a 429.
    noteRateLimited(60, t0 + 120_000, () => 0);
    const snap = getFreshnessSnapshot();
    expect(snap.failingSince).toBe(t0 + 120_000);
    // One second after a single failed poll: nothing to show yet.
    expect(isLiveUpdatesPaused(snap, t0 + 121_000)).toBe(false);
    expect(isLiveUpdatesPaused(snap, t0 + 179_000)).toBe(false);
    expect(isLiveUpdatesPaused(snap, t0 + 181_000)).toBe(true);
  });

  it("isLiveUpdatesPaused needs both a failure and 60s without data", () => {
    const base = {
      lastSuccessAt: 0,
      startedAt: 0,
      failureKind: null,
      failingSince: 0,
    };
    expect(isLiveUpdatesPaused(base, 120_000)).toBe(false);
    const failing = { ...base, failureKind: "rate_limited" as const };
    expect(isLiveUpdatesPaused(failing, 59_000)).toBe(false);
    expect(isLiveUpdatesPaused(failing, 61_000)).toBe(true);
  });
});

describe("polling budget", () => {
  it("slows REST polling while the WebSocket is connected", () => {
    const up = { available: true, connected: true };
    const down = { available: true, connected: false };
    expect(pollIntervalMs("assets", up)).toBe(300_000);
    expect(pollIntervalMs("assets", down)).toBe(30_000);
    expect(pollIntervalMs("stats", up)).toBe(120_000);
    expect(pollIntervalMs("alerts", up)).toBe(120_000);
    // Requests a minute per idle /dashboard tab (assets + stats + alerts).
    const perMin = (l: typeof up) =>
      (["assets", "stats", "alerts"] as const).reduce(
        (n, k) => n + 60_000 / pollIntervalMs(k, l),
        0,
      );
    expect(perMin(up)).toBeLessThanOrEqual(4);
    expect(perMin(down)).toBeLessThanOrEqual(8);
  });

  async function countStatsFetches(minutes: number): Promise<number> {
    const fetchMock = vi.fn(async () => okJson({ total_assets: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useStats(), { wrapper: freshSwr });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    for (let i = 0; i < minutes * 6; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }
    unmount();
    return fetchMock.mock.calls.length;
  }

  it("polls stats every 60s with the socket down", async () => {
    // Initial load + one poll a minute over 4 minutes.
    expect(await countStatsFetches(4)).toBe(5);
  });

  it("polls stats half as often with the socket up", async () => {
    live.connected = true;
    expect(await countStatsFetches(4)).toBe(3);
  });

  it("does not poll at all while the tab is hidden", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    // Only the mount fetch; no interval polls.
    expect(await countStatsFetches(4)).toBe(1);
  });
});
