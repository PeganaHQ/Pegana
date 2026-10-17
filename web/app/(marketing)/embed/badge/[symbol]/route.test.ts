/**
 * Tests for the rich iframe badge route: GET /embed/badge/[symbol]
 *
 * Covers:
 * - Content-Type: text/html
 * - Content-Security-Policy: frame-ancestors * (NOT 'none')
 * - No X-Frame-Options: ALLOWALL (removed in favour of CSP)
 * - UNKNOWN fallback on API failure
 * - Symbol / name HTML-escaped (XSS guard)
 * - State-conditional cache TTL (PEGGED=60s, non-PEGGED=15s)
 * - SVG format (?format=svg): Content-Type image/svg+xml
 * - Verify link points to /audit?asset= (not /asset/)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "./route";

// Helper: build a minimal NextRequest-like object for the route handler.
function makeRequest(
  symbol: string,
  params: Record<string, string> = {},
): Request {
  const qs = new URLSearchParams(params).toString();
  const url = `http://localhost:3000/embed/badge/${encodeURIComponent(symbol)}${qs ? `?${qs}` : ""}`;
  return new Request(url);
}

// Build the Next.js route context object (params are a Promise in Next 16).
function makeContext(symbol: string) {
  return { params: Promise.resolve({ symbol }) };
}

// Stub a successful API response for /v1/assets/{symbol}.
function stubAssetApi(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "USDC",
    name: "USD Coin",
    state: "PEGGED",
    discount: "0.0002",
    intrinsic_usd: "1.0000",
    market_usd: "0.9998",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Content-Type + CSP ────────────────────────────────────────────────────────

describe("GET /embed/badge/[symbol] - HTML response", () => {
  it("returns 200 with Content-Type: text/html", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(stubAssetApi()), { status: 200 }),
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
          new Response(JSON.stringify(stubAssetApi()), { status: 200 }),
        ),
    );
    const res = await GET(makeRequest("USDC") as never, makeContext("USDC"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors *");
    // Must NOT contain 'none' for frame-ancestors (would break cross-origin embeds)
    expect(csp).not.toContain("frame-ancestors 'none'");
  });

  it("does NOT set X-Frame-Options: ALLOWALL", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(stubAssetApi()), { status: 200 }),
        ),
    );
    const res = await GET(makeRequest("USDC") as never, makeContext("USDC"));
    expect(res.headers.get("X-Frame-Options")).toBeNull();
  });
});

// ── UNKNOWN fallback ──────────────────────────────────────────────────────────

describe("GET /embed/badge/[symbol] - UNKNOWN fallback", () => {
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
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network err")));
    const res = await GET(makeRequest("USDC") as never, makeContext("USDC"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Unknown");
  });
});

// ── XSS guard ─────────────────────────────────────────────────────────────────

describe("GET /embed/badge/[symbol] - XSS escaping", () => {
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

// ── State-conditional cache TTL ───────────────────────────────────────────────

describe("GET /embed/badge/[symbol] - cache TTL", () => {
  it("uses s-maxage=60 for PEGGED state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(stubAssetApi({ state: "PEGGED" })), {
          status: 200,
        }),
      ),
    );
    const res = await GET(makeRequest("USDC") as never, makeContext("USDC"));
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain("s-maxage=60");
  });

  it("uses s-maxage=15 for DEPEG state", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(stubAssetApi({ state: "DEPEG", discount: "-0.05" })),
            { status: 200 },
          ),
        ),
    );
    const res = await GET(makeRequest("USDe") as never, makeContext("USDe"));
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain("s-maxage=15");
  });

  it("uses s-maxage=15 for DRIFT state", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(stubAssetApi({ state: "DRIFT", discount: "-0.01" })),
            { status: 200 },
          ),
        ),
    );
    const res = await GET(makeRequest("mSOL") as never, makeContext("mSOL"));
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain("s-maxage=15");
  });
});

// ── Verify link target ────────────────────────────────────────────────────────

describe("GET /embed/badge/[symbol] - verify link", () => {
  it("links to /audit?asset= (not /asset/)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(stubAssetApi()), { status: 200 }),
        ),
    );
    const res = await GET(makeRequest("USDC") as never, makeContext("USDC"));
    const body = await res.text();
    // Primary badge link must go to /audit?asset=
    expect(body).toContain("/audit?asset=USDC");
    // Must NOT link to /asset/USDC (the old target)
    expect(body).not.toContain("/asset/USDC");
  });
});

// ── SVG format ────────────────────────────────────────────────────────────────

describe("GET /embed/badge/[symbol]?format=svg - SVG badge", () => {
  it("returns 200 with Content-Type: image/svg+xml", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(stubAssetApi()), { status: 200 }),
        ),
    );
    const res = await GET(
      makeRequest("USDC", { format: "svg" }) as never,
      makeContext("USDC"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
  });

  it("SVG sets Content-Security-Policy: frame-ancestors *", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(stubAssetApi()), { status: 200 }),
        ),
    );
    const res = await GET(
      makeRequest("USDC", { format: "svg" }) as never,
      makeContext("USDC"),
    );
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors *");
  });

  it("SVG body contains symbol text", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(stubAssetApi()), { status: 200 }),
        ),
    );
    const res = await GET(
      makeRequest("USDC", { format: "svg" }) as never,
      makeContext("USDC"),
    );
    const body = await res.text();
    expect(body).toContain("<svg");
    expect(body).toContain("USDC");
  });

  it("SVG UNKNOWN fallback on API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    const res = await GET(
      makeRequest("USDC", { format: "svg" }) as never,
      makeContext("USDC"),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Unknown");
  });

  it("SVG XSS: symbol is HTML-escaped", async () => {
    const xss = "<script>x</script>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );
    const res = await GET(
      makeRequest(xss, { format: "svg" }) as never,
      makeContext(xss),
    );
    const body = await res.text();
    expect(body).not.toContain("<script>");
  });

  it("SVG uses s-maxage=15 for non-PEGGED state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(stubAssetApi({ state: "CRITICAL" })), {
          status: 200,
        }),
      ),
    );
    const res = await GET(
      makeRequest("USDC", { format: "svg" }) as never,
      makeContext("USDC"),
    );
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=15");
  });
});

// ── Display alias (sHYUSD -> eHYUSD, display-only) ───────────────────────────

describe("GET /embed/badge/[symbol] - display alias", () => {
  it("HTML: shows eHYUSD in <title>/.symbol span, but the /audit href keeps the literal sHYUSD (KEY)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(stubAssetApi({ symbol: "sHYUSD" })), {
          status: 200,
        }),
      ),
    );
    const res = await GET(
      makeRequest("sHYUSD") as never,
      makeContext("sHYUSD"),
    );
    const body = await res.text();
    expect(body).toContain("<title>eHYUSD · Pegana</title>");
    expect(body).toContain('<span class="symbol">eHYUSD</span>');
    expect(body).not.toContain('<span class="symbol">sHYUSD</span>');
    expect(body).not.toContain("<title>sHYUSD · Pegana</title>");
    // The href is a URL (KEY) — must stay the literal, alias-resolvable DB symbol.
    expect(body).toContain("/audit?asset=sHYUSD");
  });

  it("resolves /embed/badge/eHYUSD (any case) back to sHYUSD and fetches the DB symbol", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(stubAssetApi({ symbol: "sHYUSD" })), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      makeRequest("eHYUSD") as never,
      makeContext("eHYUSD"),
    );
    expect(res.status).toBe(200);
    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/v1/assets/sHYUSD"))).toBe(true);

    const body = await res.text();
    expect(body).toContain("<title>eHYUSD · Pegana</title>");
  });

  it("resolves /embed/badge/EHYUSD (uppercase) back to sHYUSD too", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(stubAssetApi({ symbol: "sHYUSD" })), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      makeRequest("EHYUSD") as never,
      makeContext("EHYUSD"),
    );
    expect(res.status).toBe(200);
    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/v1/assets/sHYUSD"))).toBe(true);
  });

  it("SVG: shows eHYUSD in the badge text/aria-label/<title>, not the raw sHYUSD", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(stubAssetApi({ symbol: "sHYUSD" })), {
          status: 200,
        }),
      ),
    );
    const res = await GET(
      makeRequest("sHYUSD", { format: "svg" }) as never,
      makeContext("sHYUSD"),
    );
    const body = await res.text();
    expect(body).toContain("eHYUSD");
    expect(body).not.toContain("sHYUSD");
  });

  it("SVG: /embed/badge/eHYUSD?format=svg resolves to sHYUSD and fetches the DB symbol", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(stubAssetApi({ symbol: "sHYUSD" })), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      makeRequest("eHYUSD", { format: "svg" }) as never,
      makeContext("eHYUSD"),
    );
    expect(res.status).toBe(200);
    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/v1/assets/sHYUSD"))).toBe(true);
    const body = await res.text();
    expect(body).toContain("eHYUSD");
  });
});
