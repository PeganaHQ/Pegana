// Tests for the v0.2.0 full typed client (src/typed.ts). Unit tests use an
// injected mock fetch (no network); an optional live smoke test hits the real
// API when PEGANA_SDK_LIVE=1. The v0.1 regression suite (sdk.test.ts) is
// untouched and still guards the hand-rolled receipt surface.

import { describe, expect, it } from "bun:test";
import {
  createPeganaApi,
  unwrapList,
  toNumberUnsafe,
} from "../src/index.ts";

describe("unwrapList (ADR-0043 envelope)", () => {
  it("returns the .data array", () => {
    expect(unwrapList({ data: [1, 2, 3] })).toEqual([1, 2, 3]);
  });
  it("returns [] for null/undefined (never throws on a degraded response)", () => {
    expect(unwrapList(null)).toEqual([]);
    expect(unwrapList(undefined)).toEqual([]);
  });
});

describe("toNumberUnsafe (decimal-string money)", () => {
  it("coerces an exact decimal string for display", () => {
    expect(toNumberUnsafe("332852367.78")).toBe(332852367.78);
    expect(toNumberUnsafe("0")).toBe(0);
  });
});

describe("createPeganaApi", () => {
  it("issues a typed GET to the configured baseUrl via the injected fetch", async () => {
    let seen: { url: string; method: string; auth: string | null } | undefined;
    const mockFetch: typeof fetch = async (input, init) => {
      const req = new Request(input, init);
      seen = {
        url: req.url,
        method: req.method,
        auth: req.headers.get("Authorization"),
      };
      return new Response(
        JSON.stringify({ ok: true, generated_at: "x", count: 0, data: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const api = createPeganaApi({
      baseUrl: "https://example.test",
      fetch: mockFetch,
    });
    const { data, error } = await api.GET("/v1/assets");
    expect(error).toBeUndefined();
    expect(data?.data).toEqual([]); // list envelope → .data
    expect(seen?.method).toBe("GET");
    expect(seen?.url).toBe("https://example.test/v1/assets");
    expect(seen?.auth).toBeNull(); // no token → no Authorization header
  });

  it("attaches a bearer token to the authenticated surface", async () => {
    let auth: string | null = null;
    const mockFetch: typeof fetch = async (input, init) => {
      auth = new Request(input, init).headers.get("Authorization");
      return new Response(JSON.stringify({ id: "u1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const api = createPeganaApi({
      baseUrl: "https://example.test",
      token: "jwt-abc",
      fetch: mockFetch,
    });
    await api.GET("/v1/me");
    expect(auth).toBe("Bearer jwt-abc");
  });
});

// Live end-to-end against production — gated so offline/CI runs skip it.
// Run with: PEGANA_SDK_LIVE=1 bun test
describe("live smoke (PEGANA_SDK_LIVE=1)", () => {
  it.skipIf(process.env.PEGANA_SDK_LIVE !== "1")(
    "GET /v1/assets returns the ApiList envelope with rows",
    async () => {
      const api = createPeganaApi();
      const { data, error } = await api.GET("/v1/assets");
      expect(error).toBeUndefined();
      expect(Array.isArray(data?.data)).toBe(true);
      expect((data?.count ?? 0) > 0).toBe(true);
    },
  );
});
