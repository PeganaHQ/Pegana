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
const fake = vi.hoisted(() => ({
  stats: { loanToValue: 0.5 as unknown, liquidationLtv: 0.8 as unknown, userTotalBorrow: 50 as unknown },
  collateral: 100 as unknown,
}));

vi.mock("@kamino-finance/klend-sdk", async (orig) => {
  const real = await orig<typeof import("@kamino-finance/klend-sdk")>();
  class FakeKaminoObligation {
    static addRatesForObligation = vi.fn();
    refreshedStats = { ...fake.stats };
    deposits = new Map([["RES", { marketValueRefreshed: fake.collateral }]]);
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

  describe("garbage upstream fields never become a valid position", () => {
    const run = async () => {
      const { Obligation } = await import("@kamino-finance/klend-sdk");
      const buf = Buffer.alloc(Obligation.layout.span + 8);
      Buffer.from(Obligation.discriminator).copy(buf, 0);
      const pager = vi.fn().mockImplementation(async function* () {
        if (pager.mock.calls.length === 1) yield [{ pubkey: "OBL1", data: buf.toString("base64") }];
      });
      return streamReserveEntries(market, "u", "RES" as never, 1n, pager as never);
    };
    const reset = () => {
      fake.stats = { loanToValue: 0.5, liquidationLtv: 0.8, userTotalBorrow: 50 };
      fake.collateral = 100;
    };

    it.each(["abc", "-0.8", NaN, undefined, null, "", "Infinity", Infinity, -Infinity, "1e3x", " ", "\n", [], "0x10"].map((v) => [v]))(
      "liquidationLtv %j emits no entry (no hf=0 liquidatable position)",
      async (bad) => {
        fake.stats = { loanToValue: 0.5, liquidationLtv: bad, userTotalBorrow: 50 };
        expect(await run()).toEqual([]);
        reset();
      },
    );

    it.each(["abc", "-1", NaN, undefined, "Infinity", " ", "\n", [], "0x10"].map((v) => [v]))("borrow %j emits no entry", async (bad) => {
      fake.stats = { loanToValue: 0.5, liquidationLtv: 0.8, userTotalBorrow: bad };
      expect(await run()).toEqual([]);
      reset();
    });

    it.each(["abc", "-5", NaN, undefined, " ", "\n", [], "0x10"].map((v) => [v]))("collateral %j emits no entry", async (bad) => {
      fake.collateral = bad;
      expect(await run()).toEqual([]);
      reset();
    });

    it("garbage loanToValue is skipped, not treated as a borrow", async () => {
      fake.stats = { loanToValue: "abc", liquidationLtv: 0.8, userTotalBorrow: 50 };
      expect(await run()).toEqual([]);
      reset();
    });

    it("a legitimate '0' liquidationLtv emits hf=0 (a real reading, not garbage)", async () => {
      fake.stats = { loanToValue: 0.5, liquidationLtv: "0", userTotalBorrow: 50 };
      expect(await run()).toEqual([{ hf: 0, collateralUsd: 100, debtUsd: 50, liquidationLtv: 0 }]);
      reset();
    });

    it("a legitimate '0' borrow and a '0' collateral still emit", async () => {
      fake.stats = { loanToValue: 0.5, liquidationLtv: 0.8, userTotalBorrow: "0" };
      expect(await run()).toEqual([{ hf: 1.6, collateralUsd: 100, debtUsd: 0, liquidationLtv: 0.8 }]);
      fake.stats = { loanToValue: 0.5, liquidationLtv: 0.8, userTotalBorrow: 50 };
      fake.collateral = "0";
      expect(await run()).toEqual([{ hf: 1.6, collateralUsd: 0, debtUsd: 50, liquidationLtv: 0.8 }]);
      reset();
    });

    it("whitespace around a valid number is tolerated", async () => {
      fake.stats = { loanToValue: " 0.5 ", liquidationLtv: "0.8\n", userTotalBorrow: " 50" };
      expect(await run()).toEqual([{ hf: 1.6, collateralUsd: 100, debtUsd: 50, liquidationLtv: 0.8 }]);
      reset();
    });

    it("a valid position still emits", async () => {
      reset();
      expect(await run()).toEqual([{ hf: 1.6, collateralUsd: 100, debtUsd: 50, liquidationLtv: 0.8 }]);
    });
  });
});
