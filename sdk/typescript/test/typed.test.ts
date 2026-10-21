// Tests for the v0.2.0 full typed client (src/typed.ts). Unit tests use an
// injected mock fetch (no network); an optional live smoke test hits the real
// API when PEGANA_SDK_LIVE=1. The v0.1 regression suite (sdk.test.ts) is
// untouched and still guards the hand-rolled receipt surface.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  createPeganaApi,
  unwrapList,
  toNumberUnsafe,
} from "../src/index.ts";

describe("baseUrl trailing slashes", () => {
  async function urlFor(baseUrl: string): Promise<string> {
    let seen = "";
    const mockFetch: typeof fetch = async (input, init) => {
      seen = new Request(input, init).url;
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await createPeganaApi({ baseUrl, fetch: mockFetch }).GET("/healthz");
    return seen;
  }
  it("drops every trailing slash", async () => {
    expect(await urlFor("https://a.test")).toBe("https://a.test/healthz");
    expect(await urlFor("https://a.test/")).toBe("https://a.test/healthz");
    expect(await urlFor("https://a.test///")).toBe("https://a.test/healthz");
    expect(await urlFor("https://a.test/base/")).toBe("https://a.test/base/healthz");
  });
});

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
  it("trims trailing slashes from baseUrl in linear time", async () => {
    let url = "";
    const mockFetch: typeof fetch = async (input, init) => {
      url = new Request(input, init).url;
      return new Response(JSON.stringify({ ok: true, generated_at: "x", count: 0, data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const api = createPeganaApi({ baseUrl: "https://example.test///", fetch: mockFetch });
    await api.GET("/v1/assets");
    expect(url).toBe("https://example.test/v1/assets");
    // Pathological input must not hang (was quadratic with /\/+$/).
    const t0 = Date.now();
    createPeganaApi({ baseUrl: "a" + "/".repeat(200_000) + "b", fetch: mockFetch });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

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

  it("attaches a bearer token when one is configured", async () => {
    let auth: string | null = null;
    const mockFetch: typeof fetch = async (input, init) => {
      auth = new Request(input, init).headers.get("Authorization");
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const api = createPeganaApi({
      baseUrl: "https://example.test",
      token: "jwt-abc",
      fetch: mockFetch,
    });
    // /v1/me was removed from the API in 0.4.0; use a path the spec still has.
    await api.GET("/healthz");
    expect(auth).toBe("Bearer jwt-abc");
  });
});

// The removed endpoints must not come back through a stale regeneration: the
// published 0.3.x clients still typed /v1/alerts, /v1/me and /v1/auth, which
// all 404 on the live API.
describe("generated schema matches the live endpoint set", () => {
  const schema = readFileSync(
    new URL("../src/schema.d.ts", import.meta.url),
    "utf8",
  );
  for (const removed of ["/v1/alerts", "/v1/me", "/v1/auth"]) {
    it(`has no ${removed} path`, () => {
      // Match the path key exactly or as a prefix segment ("/v1/me/..."), not
      // as a string prefix ("/v1/methodology" must not count as "/v1/me").
      expect(schema.includes(`"${removed}"`)).toBe(false);
      expect(schema.includes(`"${removed}/`)).toBe(false);
    });
  }
  it("still types the receipts ledger with cursor paging", () => {
    expect(schema).toContain('"/v1/audit": {');
    expect(schema).toContain("before_id?:");
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
