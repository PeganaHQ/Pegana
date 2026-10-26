import { describe, it, expect } from "vitest";
import {
  classifyRpcFailure,
  isQuotaExhausted,
  isRetryableRpcFailure,
  QuotaExhaustedError,
} from "../src/rpc-quota";

describe("classifyRpcFailure", () => {
  /**
   * The exact strings production emitted while Sub-C's HF sources were dark
   * from 2026-08-02 to 2026-08-10. Both are 429s, and the old code retried
   * both — which is what burned ~250k Helius calls against a spent allowance.
   */
  it("separates the two real production 429s", () => {
    expect(
      classifyRpcFailure(
        new Error("429 Too Many Requests: max usage reached"),
      ),
    ).toBe("quota_exhausted");

    expect(
      classifyRpcFailure(
        new Error("SolanaError: HTTP error (429): Too Many Requests"),
      ),
    ).toBe("rate_limited");
  });

  it("only a genuine rate limit is retried", () => {
    expect(isRetryableRpcFailure(new Error("HTTP error (429): Too Many Requests"))).toBe(true);
    expect(isRetryableRpcFailure(new Error("429: max usage reached"))).toBe(false);
    // A quota error must never be retried, however it is phrased.
    for (const msg of [
      "max usage reached",
      "credits exhausted",
      "quota exceeded",
      "plan limit reached",
      "monthly usage limit hit",
    ]) {
      expect(isQuotaExhausted(new Error(msg)), msg).toBe(true);
      expect(isRetryableRpcFailure(new Error(msg)), msg).toBe(false);
    }
  });

  /**
   * Ordering matters: a quota message ALSO contains "429", so a naive
   * rate-limit-first check would classify every exhaustion as retryable and
   * the distinction would be dead code.
   */
  it("checks exhaustion before the generic 429", () => {
    expect(classifyRpcFailure(new Error("429 max usage reached"))).toBe(
      "quota_exhausted",
    );
  });

  it("leaves unrelated failures alone", () => {
    for (const msg of ["ECONNRESET", "500 Internal Server Error", "timeout"]) {
      expect(classifyRpcFailure(new Error(msg)), msg).toBe("other");
      expect(isRetryableRpcFailure(new Error(msg)), msg).toBe(false);
      expect(isQuotaExhausted(new Error(msg)), msg).toBe(false);
    }
  });

  it("handles non-Error throwables and casing", () => {
    expect(classifyRpcFailure("429 MAX USAGE REACHED")).toBe("quota_exhausted");
    expect(classifyRpcFailure({ message: "Too Many Requests" })).toBe("rate_limited");
    expect(classifyRpcFailure(null)).toBe("other");
    expect(classifyRpcFailure(undefined)).toBe("other");
  });
});

describe("QuotaExhaustedError", () => {
  it("carries the source and stays instanceof-checkable across the cycle", () => {
    const e = new QuotaExhaustedError("kamino_hf", new Error("max usage reached"));
    expect(e).toBeInstanceOf(QuotaExhaustedError);
    expect(e).toBeInstanceOf(Error);
    expect(e.source).toBe("kamino_hf");
    expect(e.message).toContain("kamino_hf");
    expect(e.message).toContain("quota exhausted");
  });

  it("truncates a huge upstream body instead of logging it whole", () => {
    const e = new QuotaExhaustedError("jupiter_lend_hf", "x".repeat(5000));
    expect(e.message.length).toBeLessThan(400);
  });
});
