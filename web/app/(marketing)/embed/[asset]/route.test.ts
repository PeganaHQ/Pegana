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
import { GET } from "./route";

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
