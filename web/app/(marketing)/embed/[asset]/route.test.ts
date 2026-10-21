// @vitest-environment node
/**
 * Tests for GET /embed/[asset] — minimal iframe badge.
 *
 * Covers:
 * - Content-Type: text/html
 * - Content-Security-Policy: frame-ancestors * (no 'none')
 * - UNKNOWN fallback on API failure
 * - XSS escaping on asset symbol
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { GET, __resetLastGoodForTests } from "./route";

function makeRequest(asset: string): Request {
  return new Request(
    `http://localhost:3000/embed/${encodeURIComponent(asset)}`,
  );
}

function makeContext(asset: string) {
  return { params: Promise.resolve({ asset }) };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetLastGoodForTests();
});

describe("GET /embed/[asset] - CSP + Content-Type", () => {
  it("returns 200 with Content-Type: text/html", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ state: "PEGGED", discount: "0.0001" }), {
          status: 200,
        }),
      ),
    );
    const res = await GET(makeRequest("USDC") as never, makeContext("USDC"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("sets Content-Security-Policy: frame-ancestors *", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ state: "PEGGED" }), { status: 200 }),
        ),
    );
    const res = await GET(makeRequest("USDC") as never, makeContext("USDC"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors *");
    expect(csp).not.toContain("frame-ancestors 'none'");
  });

  it("does NOT set X-Frame-Options header", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ state: "PEGGED" }), { status: 200 }),
        ),
    );
    const res = await GET(makeRequest("USDC") as never, makeContext("USDC"));
    expect(res.headers.get("X-Frame-Options")).toBeNull();
  });
});

describe("GET /embed/[asset] - UNKNOWN fallback", () => {
  it("renders UNKNOWN badge when API returns non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    const res = await GET(makeRequest("USDC") as never, makeContext("USDC"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Unknown");
  });

  it("renders UNKNOWN badge when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const res = await GET(makeRequest("USDe") as never, makeContext("USDe"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Unknown");
  });
});

describe("GET /embed/[asset] - XSS escaping", () => {
  it("HTML-escapes a symbol containing <script>", async () => {
    const xss = "<script>alert(1)</script>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );
    const res = await GET(makeRequest(xss) as never, makeContext(xss));
    const body = await res.text();
    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });
});

describe("GET /embed/[asset] - verify link", () => {
  it("badge link points to /audit?asset=", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ state: "PEGGED" }), { status: 200 }),
        ),
    );
    const res = await GET(makeRequest("USDC") as never, makeContext("USDC"));
    const body = await res.text();
    expect(body).toContain("/audit?asset=USDC");
  });
});

describe("GET /embed/[asset] - soft-fail never pins Unknown", () => {
  const fresh = () => new Date().toISOString();

  /** fetch stub routed by URL: /state and the asset detail answer separately. */
  function stubApi(opts: {
    state: () => Response | Promise<Response>;
    detail: () => Response | Promise<Response>;
  }) {
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      return u.endsWith("/state") ? opts.state() : opts.detail();
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  it("serves the last good verdict, marked stale, when /state then 429s", async () => {
    stubApi({
      state: () =>
        json({ state: "DRIFT", discount: "0.0024", updated_at: fresh() }),
      detail: () => new Response(null, { status: 503 }),
    });
    const first = await GET(makeRequest("jitoSOL") as never, makeContext("jitoSOL"));
    const firstBody = await first.text();
    expect(firstBody).toContain("Drift");
    expect(firstBody).not.toContain('class="stl"');
    expect(first.headers.get("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=60",
    );

    stubApi({
      state: () => json({ error: "rate_limited" }, 429),
      detail: () => new Response(null, { status: 503 }),
    });
    const res = await GET(makeRequest("jitoSOL") as never, makeContext("jitoSOL"));
    const body = await res.text();
    expect(body).toContain("Drift");
    expect(body).not.toContain("Unknown");
    expect(body).toContain('class="stl"');
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=10");
  });

  it("falls back to the asset-detail read when this instance has no last good", async () => {
    stubApi({
      state: () => new Response(null, { status: 502 }),
      detail: () =>
        json({
          symbol: "sHYUSD",
          class: "stable_yield",
          state: "DRIFT",
          discount: "0.0024",
          updated_at: fresh(),
        }),
    });
    const res = await GET(makeRequest("eHYUSD") as never, makeContext("eHYUSD"));
    const body = await res.text();
    expect(body).toContain("Drift");
    expect(body).toContain('class="stl"');
    // The display alias still prints, the canonical symbol is what is fetched.
    expect(body).toContain("eHYUSD");
    expect(body).toContain("/audit?asset=sHYUSD");
  });

  it("an Unknown fallback is held at the edge for 10s at most, with no stale window", async () => {
    stubApi({
      state: () => json({ error: "rate_limited" }, 429),
      detail: () => json({ error: "rate_limited" }, 429),
    });
    const res = await GET(makeRequest("jitoSOL") as never, makeContext("jitoSOL"));
    expect(await res.text()).toContain("Unknown");
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toBe("public, s-maxage=10");
    expect(cc).not.toContain("stale-while-revalidate");
  });

  it("never remembers or falls back to a verdict with a null updated_at", async () => {
    stubApi({
      state: () => json({ state: "DRIFT", discount: "0.0024", updated_at: null }),
      detail: () => new Response(null, { status: 503 }),
    });
    const first = await GET(makeRequest("jitoSOL") as never, makeContext("jitoSOL"));
    expect(await first.text()).toContain("Drift");

    stubApi({
      state: () => json({ error: "rate_limited" }, 429),
      detail: () =>
        json({ symbol: "jitoSOL", class: "lst", state: "DRIFT", updated_at: null }),
    });
    const res = await GET(makeRequest("jitoSOL") as never, makeContext("jitoSOL"));
    const body = await res.text();
    expect(body).toContain("Unknown");
    expect(body).not.toContain('class="stl"');
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=10");
  });

  it("styles the stale marker at 12px in an AA colour", async () => {
    stubApi({
      state: () => json({ state: "PEGGED", updated_at: fresh() }),
      detail: () => json({ symbol: "USDC", class: "stable_fiat", state: "PEGGED" }),
    });
    const res = await GET(makeRequest("USDC") as never, makeContext("USDC"));
    const css = (await res.text()).match(/\.stl\{[^}]*\}/)?.[0] ?? "";
    expect(css).toContain("12px");
    // #8f8aa3 on the #0a0a0b badge is 5.97:1 (AA needs 4.5:1).
    expect(css).toContain("color:#8f8aa3");
  });

  it("does not serve a last good verdict past the freshness gate", async () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    stubApi({
      state: () => json({ error: "x" }, 503),
      detail: () =>
        json({ symbol: "jitoSOL", class: "lst", state: "DRIFT", updated_at: old }),
    });
    const res = await GET(makeRequest("jitoSOL") as never, makeContext("jitoSOL"));
    expect(await res.text()).toContain("Unknown");
  });

  it("reads /state with no-store and the SSR token header", async () => {
    vi.stubEnv("PEGANA_WEB_SSR_TOKEN", "tok");
    const fn = stubApi({
      state: () => json({ state: "PEGGED", updated_at: fresh() }),
      detail: () => json({ symbol: "USDC", class: "stable", state: "PEGGED" }),
    });
    await GET(makeRequest("USDC") as never, makeContext("USDC"));
    const call = fn.mock.calls.find((c) => String(c[0]).endsWith("/state"))!;
    const init = (call as unknown as [string, RequestInit])[1];
    expect(init.cache).toBe("no-store");
    expect((init.headers as Record<string, string>)["x-pegana-ssr-token"]).toBe("tok");
    vi.unstubAllEnvs();
  });
});
