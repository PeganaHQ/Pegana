import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/lst/fetch-directory", () => ({
  fetchLstDirectory: async () => ({
    status: "ok",
    rows: [{ mint: "SvgMint111", logoUri: "https://cdn.example.com/logo.svg" }],
  }),
}));

import { GET } from "@/app/api/token-logo/route";

afterEach(() => vi.unstubAllGlobals());

describe("token-logo response headers", () => {
  it("serves a relayed SVG inert: sandboxed, script-less CSP + inline disposition", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(svg, { status: 200, headers: { "content-type": "image/svg+xml" } }),
      ),
    );
    const res = await GET(new Request("https://www.pegana.xyz/api/token-logo?mint=SvgMint111"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/\bsandbox\b/);
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).not.toMatch(/script-src/);
    expect(res.headers.get("content-disposition")).toBe('inline; filename="logo.svg"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
