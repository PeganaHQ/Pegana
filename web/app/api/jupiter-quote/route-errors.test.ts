import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "./route";

const JITOSOL = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const url = `https://www.pegana.xyz/api/jupiter-quote?inputMint=${JITOSOL}&outputMint=${USDC}&amount=1000000&slippageBps=50`;

afterEach(() => vi.unstubAllGlobals());

describe("jupiter-quote failure responses", () => {
  it("passes an upstream 429 on as an uncached 503 with Jupiter's Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("rate limited", {
            status: 429,
            headers: { "retry-after": "7", "x-ratelimit-remaining": "0" },
          }),
      ),
    );
    const res = await GET(new Request(url));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("retry-after")).toBe("7");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(await res.json()).toMatchObject({ upstreamStatus: 429 });
  });

  it("derives Retry-After from x-ratelimit-reset when Jupiter sends no Retry-After", async () => {
    const reset = Math.floor(Date.now() / 1000) + 9;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("rate limited", {
            status: 429,
            headers: { "x-ratelimit-reset": String(reset) },
          }),
      ),
    );
    const res = await GET(new Request(url));
    const ra = Number(res.headers.get("retry-after"));
    expect(ra).toBeGreaterThanOrEqual(8);
    expect(ra).toBeLessThanOrEqual(10);
    expect(res.headers.get("x-ratelimit-reset")).toBe(String(reset));
  });

  it("invents no Retry-After when Jupiter gives no rate-limit hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    const res = await GET(new Request(url));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBeNull();
    expect(await res.json()).toMatchObject({ upstreamStatus: 429 });
  });

  it("never caches a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const res = await GET(new Request(url));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not pass rate-limit headers through on a cached 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ outAmount: "1" }), {
            status: 200,
            headers: { "x-ratelimit-remaining": "3", "x-ratelimit-reset": "1792619558" },
          }),
      ),
    );
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-remaining")).toBeNull();
    expect(res.headers.get("x-ratelimit-reset")).toBeNull();
  });

  it("keeps caching a good quote at the edge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ outAmount: "1" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
    // 60s at the CDN, plus at most 120s stale while one request refreshes it.
    expect(res.headers.get("cache-control")).toBe(
      "s-maxage=60, stale-while-revalidate=120",
    );
  });

  it("fetches upstream with no-store, so the CDN window is the only cache", async () => {
    // A Next Data Cache entry (`next: { revalidate }`) is served past its
    // expiry while it refreshes, so a quote could be hours old after an idle
    // period. With no-store, a served quote is at most the CDN's 60s old.
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ outAmount: "1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await GET(new Request(url));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit & {
      next?: unknown;
    };
    expect(init.cache).toBe("no-store");
    expect(init.next).toBeUndefined();
  });
});

describe("jupiter-quote request validation", () => {
  const base = `https://www.pegana.xyz/api/jupiter-quote?inputMint=${JITOSOL}&outputMint=${USDC}`;

  function upstreamNeverCalled() {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function expectUncached400(res: Response) {
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  }

  it("accepts exactly what the exit-liquidity widget sends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ outAmount: "1" }), { status: 200 })),
    );
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
  });

  it("accepts a request without slippageBps (defaults to 50)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ outAmount: "1" }), { status: 200 })),
    );
    const res = await GET(new Request(`${base}&amount=1000000`));
    expect(res.status).toBe(200);
  });

  it("rejects an unknown parameter so it cannot bust the CDN cache", async () => {
    const fetchMock = upstreamNeverCalled();
    await expectUncached400(await GET(new Request(`${url}&cb=123`)));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a repeated parameter", async () => {
    const fetchMock = upstreamNeverCalled();
    await expectUncached400(await GET(new Request(`${url}&amount=2000000`)));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a 20-digit amount and rejects a 21-digit one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ outAmount: "1" }), { status: 200 })),
    );
    const ok = await GET(new Request(`${base}&amount=${"1".repeat(20)}&slippageBps=50`));
    expect(ok.status).toBe(200);
    const fetchMock = upstreamNeverCalled();
    await expectUncached400(
      await GET(new Request(`${base}&amount=${"1".repeat(21)}&slippageBps=50`)),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "1e6", "1.5", "0x10", ""])(
    "rejects a non-digit or zero amount (%s)",
    async (amount) => {
      const fetchMock = upstreamNeverCalled();
      await expectUncached400(
        await GET(new Request(`${base}&amount=${encodeURIComponent(amount)}&slippageBps=50`)),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("gives unsupported_pair an uncached 400", async () => {
    const fetchMock = upstreamNeverCalled();
    const sol = "So11111111111111111111111111111111111111112";
    const res = await GET(
      new Request(
        `https://www.pegana.xyz/api/jupiter-quote?inputMint=${sol}&outputMint=${USDC}&amount=1000000&slippageBps=50`,
      ),
    );
    await expectUncached400(res);
    expect(await res.json()).toEqual({ error: "unsupported_pair" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
