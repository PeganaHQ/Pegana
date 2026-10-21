import { describe, it, expect, vi, afterEach } from "vitest";
import { api, ApiError, isRateLimited, parseRetryAfter } from "@/lib/api/client";
import { errorRetryDelayMs, ERROR_RETRY_COUNT } from "@/lib/api/swr-retry";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseRetryAfter", () => {
  it("reads delta-seconds", () => {
    expect(parseRetryAfter("60")).toBe(60);
    expect(parseRetryAfter(" 7 ")).toBe(7);
  });
  it("reads an HTTP date relative to now", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    expect(parseRetryAfter("Tue, 20 Oct 2026 12:00:30 GMT", now)).toBe(30);
  });
  it("returns undefined for missing or junk values", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});

describe("fetchJson on 429", () => {
  it("throws an ApiError carrying status 429 and the Retry-After seconds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("{}", { status: 429, headers: { "retry-after": "45" } }),
      ),
    );
    const err = await api.asset("USDT").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.retryAfterSec).toBe(45);
    expect(isRateLimited(err)).toBe(true);
  });
  it("is not rate-limited for a 503 or a network drop", () => {
    expect(isRateLimited(new ApiError("x", "/v1/assets", 503))).toBe(false);
    expect(isRateLimited(new ApiError("x", "/v1/assets"))).toBe(false);
    expect(isRateLimited(undefined)).toBe(false);
  });
});

describe("errorRetryDelayMs", () => {
  it("never retries a 404", () => {
    expect(errorRetryDelayMs(new ApiError("x", "/p", 404), 1)).toBeNull();
  });
  it("waits Retry-After on a 429 instead of the fixed 5s", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(errorRetryDelayMs(new ApiError("x", "/p", 429, 45), 1)).toBe(45_000);
  });
  it("falls back to a full 60s window on a 429 without Retry-After", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(errorRetryDelayMs(new ApiError("x", "/p", 429), 1)).toBe(60_000);
  });
  it("backs off exponentially for other errors and stops after the cap", () => {
    const e = new ApiError("x", "/p", 503);
    expect(errorRetryDelayMs(e, 1)).toBe(5_000);
    expect(errorRetryDelayMs(e, 2)).toBe(10_000);
    expect(errorRetryDelayMs(e, ERROR_RETRY_COUNT + 1)).toBeNull();
  });
});
