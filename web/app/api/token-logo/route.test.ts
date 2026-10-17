import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DirectoryFetchResult } from "@/lib/lst/fetch-directory";

const fetchLstDirectoryMock = vi.fn<() => Promise<DirectoryFetchResult>>();

vi.mock("@/lib/lst/fetch-directory", () => ({
  fetchLstDirectory: () => fetchLstDirectoryMock(),
}));

const { GET } = await import("./route");

function req(mint?: string): Request {
  const url = mint
    ? `http://localhost/api/token-logo?mint=${encodeURIComponent(mint)}`
    : "http://localhost/api/token-logo";
  return new Request(url);
}

// The route validates the BYTES, not the upstream's declared content-type (an
// upstream serving HTML under `Content-Type: image/png` is a real failure mode).
// So a mock that wants to reach the success path must emit real magic bytes.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
/** RIFF....WEBP */
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function directoryRow(
  overrides: Partial<{ mint: string; logoUri: string | null }> = {},
) {
  return {
    mint: "MintA",
    symbol: "aSOL",
    name: "A Staked SOL",
    logoUri: "https://arweave.net/some-logo.png",
    poolProgram: null,
    tvlUsd: null,
    apy: null,
    rate: null,
    flags: { deprecated: false, dead: false, stale: false },
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

describe("GET /api/token-logo", () => {
  beforeEach(() => {
    fetchLstDirectoryMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("404s when mint is missing", async () => {
    const res = await GET(req());
    expect(res.status).toBe(404);
  });

  it("404s when the directory is unreachable", async () => {
    fetchLstDirectoryMock.mockResolvedValue({ status: "unreachable" });
    const res = await GET(req("MintA"));
    expect(res.status).toBe(404);
  });

  it("404s when no row matches the mint", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow({ mint: "OtherMint" })],
    });
    const res = await GET(req("MintA"));
    expect(res.status).toBe(404);
  });

  it("404s when the matched row has no logoUri", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow({ logoUri: null })],
    });
    const res = await GET(req("MintA"));
    expect(res.status).toBe(404);
  });

  it("404s when the logoUri is malformed", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow({ logoUri: "not a url" })],
    });
    const res = await GET(req("MintA"));
    expect(res.status).toBe(404);
  });

  it("404s when the logoUri protocol is not http(s) (ssrf: file://)", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow({ logoUri: "file:///etc/passwd" })],
    });
    const res = await GET(req("MintA"));
    expect(res.status).toBe(404);
  });

  it.each([
    "http://localhost/logo.png",
    "http://127.0.0.1/logo.png",
    "http://10.0.0.5/logo.png",
    "http://192.168.1.1/logo.png",
    "http://172.16.0.1/logo.png",
    "http://172.31.255.254/logo.png",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/logo.png",
    "http://[::1]/logo.png",
    "http://[fc00::1]/logo.png",
    "http://[fe80::1]/logo.png",
    // IPv4-mapped IPv6 literals — Node's URL parser renders these as
    // [::ffff:<hex>] which bypassed the dotted-decimal rules (#R5-A).
    "http://[::ffff:127.0.0.1]/logo.png",
    "http://[::ffff:169.254.169.254]/latest/meta-data/",
    "http://[::ffff:10.0.0.5]/logo.png",
    "http://[::ffff:192.168.1.1]/logo.png",
    "http://[::]/logo.png",
    // IPv6 transition-prefix SSRF bypasses (NAT64 / 6to4) (#R6).
    "http://[64:ff9b::a9fe:a9fe]/latest/meta-data/", // NAT64 -> 169.254.169.254
    "http://[2002:7f00:1::]/logo.png", // 6to4 -> 127.0.0.1
  ])(
    "404s for a private/loopback/link-local logoUri host (ssrf: %s)",
    async (logoUri) => {
      fetchLstDirectoryMock.mockResolvedValue({
        status: "ok",
        rows: [directoryRow({ logoUri })],
      });
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const res = await GET(req("MintA"));
      expect(res.status).toBe(404);
      // The private-host guard must reject BEFORE the upstream fetch happens.
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("does not reject a public IPv4 that merely starts with a private octet (172.32.x, not 172.16-31.x)", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow({ logoUri: "http://172.32.0.1/logo.png" })],
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    ) as unknown as typeof fetch;

    const res = await GET(req("MintA"));
    expect(res.status).toBe(200);
  });

  it("never auto-follows redirects, passes redirect:manual so a 3xx can't reach an unvalidated host (ssrf via redirect)", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow()],
    });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await GET(req("MintA"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = (fetchSpy.mock.calls[0]?.[1] ?? {}) as RequestInit;
    // Only the first hop's host is validated; auto-following a redirect would
    // let a public logoUri 302 to 127.0.0.1 / 169.254.169.254 unvalidated.
    expect(init.redirect).toBe("manual");
  });

  it("404s when the upstream responds non-ok", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow()],
    });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 404 }),
      ) as unknown as typeof fetch;

    const res = await GET(req("MintA"));
    expect(res.status).toBe(404);
  });

  it("404s when the upstream content-type is not an image", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow()],
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("<html>not an image</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;

    const res = await GET(req("MintA"));
    expect(res.status).toBe(404);
  });

  it("404s when the BYTES are not an image, even though the header claims image/png", async () => {
    // The header is attacker-influenced: a compromised or hostile CDN can serve
    // an HTML payload under `Content-Type: image/png`. Relaying that under our
    // own origin is what this check prevents; `nosniff` stops execution, but we
    // should never have proxied it in the first place.
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow()],
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("<!DOCTYPE html><script>alert(1)</script>", {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    ) as unknown as typeof fetch;

    const res = await GET(req("MintA"));
    expect(res.status).toBe(404);
  });

  it("serves the SNIFFED content-type, not the upstream's declared one", async () => {
    // Upstream mislabels a real PNG as JPEG. We serve what the bytes actually
    // are, so the response never carries a type the content does not match.
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow()],
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    ) as unknown as typeof fetch;

    const res = await GET(req("MintA"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("404s when content-length declares a body over the 1 MB cap", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow()],
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new ArrayBuffer(8), {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(2 * 1024 * 1024),
        },
      }),
    ) as unknown as typeof fetch;

    const res = await GET(req("MintA"));
    expect(res.status).toBe(404);
  });

  it("404s when the actual body exceeds the 1 MB cap (no honest content-length)", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow()],
    });
    const oversized = new ArrayBuffer(1024 * 1024 + 1);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(oversized, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    ) as unknown as typeof fetch;

    const res = await GET(req("MintA"));
    expect(res.status).toBe(404);
  });

  it("404s when the upstream fetch throws (network error/timeout)", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow()],
    });
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;

    const res = await GET(req("MintA"));
    expect(res.status).toBe(404);
  });

  it("proxies the image bytes with a long-lived cache header on success", async () => {
    fetchLstDirectoryMock.mockResolvedValue({
      status: "ok",
      rows: [directoryRow()],
    });
    const bytes = WEBP_BYTES;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/webp" },
      }),
    ) as unknown as typeof fetch;

    const res = await GET(req("MintA"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const buf = await res.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(WEBP_BYTES);
  });
});
