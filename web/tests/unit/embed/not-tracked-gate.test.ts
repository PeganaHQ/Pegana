import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { publicSurfaceOf } from "@/lib/asset/public-surface";
import { GET as badgeGET } from "@/app/(marketing)/embed/badge/[symbol]/route";
import { GET as iframeGET } from "@/app/(marketing)/embed/[asset]/route";

const fresh = () => new Date().toISOString();

function stubApi(byPath: Record<string, { status: number; body?: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const path = new URL(String(input)).pathname;
      const hit = byPath[path];
      if (!hit) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return new Response(JSON.stringify(hit.body ?? {}), { status: hit.status });
    }),
  );
}

const xsol = {
  symbol: "xSOL",
  name: "Hylo Leveraged SOL",
  class: "synth_lev",
  state: "PEGGED",
  discount: "-0.38",
  intrinsic_usd: "0.0489",
  market_usd: "0.0677",
  updated_at: fresh(),
};
const usdc = { ...xsol, symbol: "USDC", name: "USD Coin", class: "stable_fiat", discount: "0.0001", intrinsic_usd: "1", market_usd: "0.9999" };

const params = (symbol: string) => ({ params: Promise.resolve({ symbol }) });

describe("publicSurfaceOf", () => {
  it("treats a 404 and a leveraged synth as not tracked", () => {
    expect(publicSurfaceOf({ kind: "not_found" })).toBe("not_tracked");
    expect(
      publicSurfaceOf({ kind: "found", asset: xsol as never }),
    ).toBe("not_tracked");
  });
  it("never claims not-tracked when the API is unavailable", () => {
    expect(publicSurfaceOf({ kind: "unavailable" })).toBe("unavailable");
  });
  it("tracks a normal asset", () => {
    expect(publicSurfaceOf({ kind: "found", asset: usdc as never })).toBe("tracked");
  });
});

describe("embed badge gate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serves a neutral 404 SVG for xSOL, never a Pegged verdict", async () => {
    stubApi({ "/v1/assets/xSOL": { status: 200, body: xsol } });
    const res = await badgeGET(
      new NextRequest("https://www.pegana.xyz/embed/badge/xSOL?format=svg"),
      params("xSOL"),
    );
    expect(res.status).toBe(404);
    const svg = await res.text();
    expect(svg).toContain("not tracked");
    expect(svg).not.toMatch(/Pegged/);
  });

  it("serves a neutral 404 iframe for an unknown symbol", async () => {
    stubApi({ "/v1/assets/NOTREAL": { status: 404 } });
    const res = await badgeGET(
      new NextRequest("https://www.pegana.xyz/embed/badge/NOTREAL"),
      params("NOTREAL"),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("NOTREAL is not tracked by Pegana");
  });

  it("still renders a tracked asset's verdict", async () => {
    stubApi({ "/v1/assets/USDC": { status: 200, body: usdc } });
    const res = await badgeGET(
      new NextRequest("https://www.pegana.xyz/embed/badge/USDC?format=svg"),
      params("USDC"),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("USDC: Pegged");
  });

  it("the minimal iframe embed applies the same gate", async () => {
    stubApi({
      "/v1/assets/xSOL": { status: 200, body: xsol },
      "/v1/assets/xSOL/state": { status: 200, body: xsol },
    });
    const res = await iframeGET(
      new NextRequest("https://www.pegana.xyz/embed/xSOL"),
      { params: Promise.resolve({ asset: "xSOL" }) },
    );
    expect(res.status).toBe(404);
    expect(await res.text()).not.toMatch(/Pegged/);
  });

  it("the minimal iframe resolves the eHYUSD display alias to sHYUSD", async () => {
    const shyusd = {
      ...usdc,
      symbol: "sHYUSD",
      name: "Hylo Stability Pool",
      class: "yield_bearing",
    };
    stubApi({
      "/v1/assets/sHYUSD": { status: 200, body: shyusd },
      "/v1/assets/sHYUSD/state": { status: 200, body: shyusd },
    });
    const res = await iframeGET(
      new NextRequest("https://www.pegana.xyz/embed/eHYUSD"),
      { params: Promise.resolve({ asset: "eHYUSD" }) },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toMatch(/not tracked/);
    expect(html).toContain('<span class="sym">eHYUSD</span>');
  });
});
