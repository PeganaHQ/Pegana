import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJsonWithTimeout } from "../src/fetch-util";
import { num } from "../src/core/loop-util";

afterEach(() => vi.unstubAllGlobals());

describe("upstream response handling", () => {
  it("keeps the deadline active while reading the body", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      headers: new Headers(),
      text: () => new Promise<string>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    })));
    await expect(fetchJsonWithTimeout("https://example.test/data", { timeoutMs: 10 }))
      .rejects.toThrow(/fetch timeout after 10ms/);
  });

  it("rejects negative and non-finite aggregate inputs", () => {
    expect(num("-3")).toBe(0);
    expect(num(-1)).toBe(0);
    expect(num("Infinity")).toBe(0);
    expect(num("3")).toBe(3);
  });
});
