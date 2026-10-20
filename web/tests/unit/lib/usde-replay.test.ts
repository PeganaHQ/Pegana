import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fitDomain,
  linearTicks,
  tickAtOrBefore,
  REPLAY_MARKERS,
  REPLAY_TICKS,
  REPLAY_WINDOW,
  criticalMarker,
  receiptUrl,
  replayCommand,
} from "@/lib/landing/usde-replay";
import { verifyReceipt } from "@/lib/verify-receipt";

const DIR = join(process.cwd(), "..", "docs/backtests/2025-10-10-usde-depeg");
const receipt = (file: string) =>
  JSON.parse(readFileSync(join(DIR, "receipts", file), "utf8"));

describe("USDe replay data vs the committed backtest", () => {
  it("markers equal the receipts' own timestamps, states and hashes", () => {
    expect(REPLAY_MARKERS.length).toBeGreaterThanOrEqual(3);
    for (const m of REPLAY_MARKERS) {
      const r = receipt(m.file);
      expect(m.iso).toBe(r.inputs_frozen.now);
      expect(m.at).toBe(Date.parse(r.inputs_frozen.now) / 1000);
      expect(m.state).toBe(r.expected_computed.final_state);
      expect(m.previous).toBe(r.inputs_frozen.previous_state);
      expect(m.sha256).toBe(r.expected_receipt_sha256);
      expect(m.discountRaw).toBe(r.expected_computed.discount_raw);
    }
  });

  it("covers every receipt inside the window and none outside", () => {
    const inWindow: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const f = `USDe-00${i}.json`;
      const at = Date.parse(receipt(f).inputs_frozen.now) / 1000;
      if (at >= REPLAY_WINDOW.from && at <= REPLAY_WINDOW.to) inWindow.push(f);
    }
    expect(REPLAY_MARKERS.map((m) => m.file)).toEqual(inWindow);
  });

  it("marks DRIFT 21:23, DEPEG 21:28, CRITICAL 21:31 UTC as the README states", () => {
    const by = (s: string) => REPLAY_MARKERS.find((m) => m.state === s)!;
    expect(by("DRIFT").iso).toBe("2025-10-10T21:23:00Z");
    expect(by("DEPEG").iso).toBe("2025-10-10T21:28:00Z");
    expect(by("CRITICAL").iso).toBe("2025-10-10T21:31:00Z");
    expect(criticalMarker().file).toBe("USDe-003.json");
  });

  it("series values are verbatim inputs.json closes, in order, not interpolated", () => {
    const inputs = JSON.parse(readFileSync(join(DIR, "inputs.json"), "utf8"));
    const src = new Map<number, string>(
      inputs.series.USDe.ticks.map((k: { t: number; market_usd: string }) => [
        k.t,
        k.market_usd,
      ]),
    );
    for (const k of REPLAY_TICKS) expect(src.get(k.t)).toBe(k.p);
    for (let i = 1; i < REPLAY_TICKS.length; i++) {
      expect(REPLAY_TICKS[i].t - REPLAY_TICKS[i - 1].t).toBe(60);
    }
    // each marker's market_usd is the series close at that minute
    for (const m of REPLAY_MARKERS) {
      expect(REPLAY_TICKS.find((k) => k.t === m.at)?.p).toBe(m.marketUsd);
    }
  });

  it("every shown bundle recomputes to its stored sha256 in the browser verifier", async () => {
    for (const m of REPLAY_MARKERS) {
      const r = await verifyReceipt(m.bundle);
      expect(r.ok).toBe(true);
    }
  });

  it("builds the GitHub link and the CLI command for a receipt", () => {
    expect(receiptUrl("USDe-003.json")).toBe(
      "https://github.com/PeganaHQ/Pegana/blob/main/docs/backtests/2025-10-10-usde-depeg/receipts/USDe-003.json",
    );
    expect(replayCommand("USDe-001.json")).toBe(
      "pegana-replay --bundle docs/backtests/2025-10-10-usde-depeg/receipts/USDe-001.json",
    );
  });
});

describe("chart helpers", () => {
  it("fitDomain pads the real min/max by the given fraction", () => {
    const ps = REPLAY_TICKS.map((k) => Number(k.p));
    const lo = Math.min(...ps);
    const hi = Math.max(...ps);
    const { yMin, yMax } = fitDomain(0.1);
    expect(yMin).toBeCloseTo(lo - (hi - lo) * 0.1, 10);
    expect(yMax).toBeCloseTo(hi + (hi - lo) * 0.1, 10);
    expect(yMin).toBeLessThan(lo);
    expect(yMax).toBeGreaterThan(hi);
    const tight = fitDomain(0);
    expect(tight.yMin).toBe(lo);
    expect(tight.yMax).toBe(hi);
  });

  it("linearTicks rounds float noise and caps at four", () => {
    expect(linearTicks(0.955, 1.002, 0.02)).toEqual([0.96, 0.98, 1]);
    expect(linearTicks(0.5, 1.02, 0.02)).toHaveLength(4);
    expect(linearTicks(0.5, 1.02, 0.02).at(-1)).toBe(1.02);
    for (const v of linearTicks(0.955, 1.002, 0.02)) {
      expect(v).toBe(Math.round(v * 10_000) / 10_000);
    }
  });

  it("tickAtOrBefore returns an existing tick, never interpolates", () => {
    const k = REPLAY_TICKS[5];
    expect(tickAtOrBefore(k.t)).toBe(k);
    expect(tickAtOrBefore(k.t + 59)).toBe(k);
    expect(tickAtOrBefore(k.t + 60)).toBe(REPLAY_TICKS[6]);
    expect(tickAtOrBefore(REPLAY_TICKS[0].t - 1000)).toBe(REPLAY_TICKS[0]);
    expect(tickAtOrBefore(REPLAY_TICKS.at(-1)!.t + 1000)).toBe(REPLAY_TICKS.at(-1));
  });
});
