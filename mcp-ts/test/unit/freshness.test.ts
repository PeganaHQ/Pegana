import { describe, expect, it, vi, afterEach } from "vitest";
import { ageSeconds, freshness, STALE_AFTER_SEC } from "@/shared/snapshot-schema";

const now = Date.parse("2026-10-21T01:29:40.000Z");

describe("freshness (R1 audit idx 33)", () => {
  it("uses the web's 900-second window and refuses future timestamps", () => {
    expect(STALE_AFTER_SEC).toBe(900);
    expect(ageSeconds(Math.floor(now / 1000) + 10, now)).toBeLessThan(0);
    expect(freshness("2026-10-21T01:30:00.000Z", 7200, now)).toEqual({ stale: true });
  });


  it("flags data older than the threshold as stale with its age", () => {
    expect(freshness("2026-10-17T19:32:24.358Z", 7200, now)).toEqual({
      stale: true,
      data_age_sec: 280635,
    });
    expect(freshness("2026-10-21T01:00:00.000Z", 7200, now)).toEqual({
      stale: false,
      data_age_sec: 1780,
    });
  });

  it("invents nothing when there is no usable timestamp", () => {
    expect(freshness(undefined, 7200, now)).toEqual({});
    expect(freshness("garbage", 7200, now)).toEqual({});
  });
});

describe("simulate_depeg_impact surfaces staleness", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("marks 3-day-old HF bands stale", async () => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        asset: "jitoSOL",
        shock_bps: 500,
        loop_exposure_usd: "21741556.96",
        liquidatable_usd: "0",
        positions: "<5",
        coverage: "partial",
        by_protocol: [],
        advisory_note: "advisory model estimate",
        updated_at: "2026-10-17T19:32:24.358Z",
      }),
    }) as unknown as typeof fetch;
    const { simulateDepegTool } = await import("@/tools/simulate-depeg");
    const res = await simulateDepegTool.handler({ symbol: "jitoSOL", shock_bps: 500 });
    vi.useRealTimers();
    expect(res.structuredContent).toMatchObject({ stale: true, data_age_sec: 280635 });
    expect(res.structuredContent!.advisory_note).toMatch(/concentrated liquidation risk can therefore be understated/);
  });
});

describe("get_loop_exposure flags a frozen cascade behind a fresh rollup", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  const LOOP_BODY = {
    asset: "jitoSOL",
    loop_exposure_usd: "21741556.96",
    debt_usd: "1828.71",
    coverage: "partial",
    by_protocol: [],
    cascade: [{ shock_bps: 100, liquidatable_usd: "0", positions: "<5" }],
    // Fresh: the 5-minute exposure rollup, which masks the band age.
    updated_at: "2026-10-21T01:27:00.000Z",
    advisory_note: "advisory model estimate",
  };

  function stub(sim: { status: number; body?: unknown }) {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/simulate-depeg")) {
        return new Response(JSON.stringify(sim.body ?? { error: "x" }), { status: sim.status });
      }
      return new Response(JSON.stringify(structuredClone(LOOP_BODY)), { status: 200 });
    }) as unknown as typeof fetch;
    return calls;
  }

  it("fresh updated_at + 3-day-old bands: stale false, cascade_stale true", async () => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    const calls = stub({
      status: 200,
      body: { asset: "jitoSOL", shock_bps: 100, updated_at: "2026-10-17T19:32:24.358Z" },
    });
    const { getLoopExposureTool } = await import("@/tools/get-loop-exposure");
    const res = await getLoopExposureTool.handler({ symbol: "jitoSOL" });
    expect(res.structuredContent).toMatchObject({
      stale: false,
      data_age_sec: 160,
      cascade_stale: true,
      cascade_data_age_sec: 280635,
    });
    expect(res.structuredContent!.advisory_note).toMatch(/concentrated liquidation risk can therefore be understated/);
    expect(calls.some((u) => u.endsWith("/v1/assets/jitoSOL/simulate-depeg?shock_bps=100"))).toBe(true);
  });

  it("fresh bands: cascade_stale false", async () => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    stub({ status: 200, body: { updated_at: "2026-10-21T01:00:00.000Z" } });
    const { getLoopExposureTool } = await import("@/tools/get-loop-exposure");
    const res = await getLoopExposureTool.handler({ symbol: "jitoSOL" });
    expect(res.structuredContent).toMatchObject({ cascade_stale: false, cascade_data_age_sec: 1780 });
  });

  it("uses cascade_updated_at from loop-exposure without the extra probe", async () => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({ ...structuredClone(LOOP_BODY), cascade_updated_at: "2026-10-17T19:32:24.358Z" }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const { getLoopExposureTool } = await import("@/tools/get-loop-exposure");
    const res = await getLoopExposureTool.handler({ symbol: "jitoSOL" });
    expect(res.structuredContent).toMatchObject({ stale: false, cascade_stale: true, cascade_data_age_sec: 280635, cascade_updated_at: "2026-10-17T19:32:24.358Z" });
    expect(calls.some((u) => u.includes("/simulate-depeg"))).toBe(false);
  });

  it("invents nothing when band freshness is unavailable", async () => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    stub({ status: 503 });
    const { getLoopExposureTool } = await import("@/tools/get-loop-exposure");
    const res = await getLoopExposureTool.handler({ symbol: "jitoSOL" });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).not.toHaveProperty("cascade_stale");
    expect(res.structuredContent).not.toHaveProperty("cascade_data_age_sec");
  });
});
