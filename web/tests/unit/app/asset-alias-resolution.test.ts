/**
 * Light integration test for the sHYUSD -> eHYUSD display-alias resolution
 * at the asset-detail page's own URL entry point: `generateMetadata` in
 * `web/app/(app)/asset/[symbol]/layout.tsx` runs the exact same
 * `resolveAliasSymbol(decodeURIComponent(symbol))` pipeline the client page
 * component (`page.tsx`) uses to turn a `/asset/eHYUSD` URL into the real
 * `sHYUSD` DB/API symbol — but unlike the client page, it's a plain async
 * server function with no hooks, so it's cheap to exercise directly.
 *
 * No `use-asset.test.ts` (or similar) existed prior to this change.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { generateMetadata } from "@/app/(app)/asset/[symbol]/layout";

afterEach(() => {
  vi.restoreAllMocks();
});

function stubFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
  );
}

describe("asset-detail page — eHYUSD display-alias URL resolution", () => {
  it("navigating to symbol=eHYUSD fetches /v1/assets/sHYUSD (the real DB symbol)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ name: "Staked Hylo USD", state: "PEGGED" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await generateMetadata({
      params: Promise.resolve({ symbol: "eHYUSD" }),
    });

    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/v1/assets/sHYUSD"))).toBe(true);
    // Never fetches the display alias itself as an API key.
    expect(calledUrls.some((u) => u.includes("/v1/assets/eHYUSD"))).toBe(false);
  });

  it("the generated <title> shows the eHYUSD display alias, not the raw sHYUSD symbol", async () => {
    stubFetchOnce({ name: "Staked Hylo USD", state: "PEGGED" });

    const meta = await generateMetadata({
      params: Promise.resolve({ symbol: "eHYUSD" }),
    });

    expect(meta.title).toBe("eHYUSD peg state");
  });

  it("the canonical DB URL (symbol=sHYUSD) still resolves identically (identity passthrough)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ name: "Staked Hylo USD", state: "PEGGED" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const meta = await generateMetadata({
      params: Promise.resolve({ symbol: "sHYUSD" }),
    });

    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/v1/assets/sHYUSD"))).toBe(true);
    expect(meta.title).toBe("eHYUSD peg state");
  });

  it("an unrelated symbol (no alias) passes through unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: "USD Coin", state: "PEGGED" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const meta = await generateMetadata({
      params: Promise.resolve({ symbol: "USDC" }),
    });

    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/v1/assets/USDC"))).toBe(true);
    expect(meta.title).toBe("USDC peg state");
  });
});
