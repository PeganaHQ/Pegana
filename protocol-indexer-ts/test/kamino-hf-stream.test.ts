import { describe, expect, it, vi } from "vitest";
import { streamReserveEntries } from "../src/sources/kamino-hf";
import { QuotaExhaustedError } from "../src/rpc-quota";
import { PagingBudgetExceededError } from "../src/rpc-paged";

const market = { address: "MKT" } as never;

describe("streamReserveEntries", () => {
  it("queries all 8 deposit slots with bounded paging and no accounts => no entries", async () => {
    const pager = vi.fn().mockImplementation(async function* () {
      yield* [] as never[];
    });
    const out = await streamReserveEntries(market, "u", "RES" as never, 1n, pager as never);
    expect(out).toEqual([]);
    expect(pager).toHaveBeenCalledTimes(8);
    const [, , filters, opts] = pager.mock.calls[0];
    expect(opts.pageSize).toBeLessThanOrEqual(10_000);
    expect(opts.deadlineMs).toBeGreaterThan(Date.now());
    expect(filters[1].memcmp.offset).toBe(96);
    expect(pager.mock.calls[7][2][1].memcmp.offset).toBe(96 + 136 * 7);
  });

  it("maps quota exhaustion to QuotaExhaustedError", async () => {
    const pager = vi.fn().mockImplementation(async function* () {
      yield* [] as never[];
      throw new Error("rpc http 429: max usage reached");
    });
    await expect(
      streamReserveEntries(market, "u", "RES" as never, 1n, pager as never),
    ).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  it("propagates a budget overrun (caller skips the reserve, no partial bands)", async () => {
    const pager = vi.fn().mockImplementation(async function* () {
      yield* [] as never[];
      throw new PagingBudgetExceededError("time budget");
    });
    await expect(
      streamReserveEntries(market, "u", "RES" as never, 1n, pager as never),
    ).rejects.toBeInstanceOf(PagingBudgetExceededError);
  });
});

// Wiring test: real Obligation layout bytes -> Obligation.decode (real) ->
// KaminoObligation (stubbed: building real Reserves needs a live market) ->
// HfEntry. The entry is built from the same refreshedStats/deposits fields the
// old SDK path (getAllObligationsByDepositedReserve + fold) read.
vi.mock("@kamino-finance/klend-sdk", async (orig) => {
  const real = await orig<typeof import("@kamino-finance/klend-sdk")>();
  class FakeKaminoObligation {
    static addRatesForObligation = vi.fn();
    refreshedStats = { loanToValue: 0.5, liquidationLtv: 0.8, userTotalBorrow: 50 };
    deposits = new Map([["RES", { marketValueRefreshed: 100 }]]);
    constructor(
      public market: unknown,
      public addr: string,
      public state: unknown,
    ) {}
  }
  return { ...real, KaminoObligation: FakeKaminoObligation };
});

describe("streamReserveEntries wiring", () => {
  it("decodes real Obligation bytes and emits the same HfEntry fields", async () => {
    const { Obligation } = await import("@kamino-finance/klend-sdk");
    const buf = Buffer.alloc(Obligation.layout.span + 8);
    Buffer.from(Obligation.discriminator).copy(buf, 0);
    const pager = vi.fn().mockImplementation(async function* (_u, _p, _f) {
      // Only the first deposit slot returns data.
      if (pager.mock.calls.length === 1) {
        yield [{ pubkey: "OBL1", data: buf.toString("base64") }];
      }
    });
    const out = await streamReserveEntries(market, "u", "RES" as never, 1n, pager as never);
    expect(out).toEqual([{ hf: 1.6, collateralUsd: 100, debtUsd: 50, liquidationLtv: 0.8 }]);
    const filters = pager.mock.calls[0][2];
    expect(filters[0]).toEqual({ dataSize: Obligation.layout.span + 8 });
    expect(filters[1].memcmp).toMatchObject({ offset: 96, bytes: "RES", encoding: "base58" });
    expect(filters[2].memcmp).toMatchObject({ offset: 32, bytes: "MKT", encoding: "base58" });
  });
});
