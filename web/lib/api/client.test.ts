/**
 * Envelope-unwrap contract for the list endpoints.
 *
 * The `/v1` list endpoints return the uniform envelope
 * `{ ok, generated_at, count, data: [...] }`; `fetchList` (in client.ts) unwraps
 * `data` and hands callers the `T[]` they expect. These tests pin that for all
 * four list methods, including the empty-envelope case.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "./client";

afterEach(() => {
  vi.restoreAllMocks();
});

function stubFetchJson(payload: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(payload), { status })),
  );
}

// The bare row each list endpoint returns; only the fields these tests assert
// on need to be real.
const ASSET = { symbol: "USDC" };
const ALERT = { id: "a1", asset: "USDC" };
const CALIB = { symbol: "USDC", health: "ok" };
const POINT = { ts: "2026-07-24T00:00:00.000Z", discount: "0.0001" };

const CASES = [
  { name: "assets", call: () => api.assets(), row: ASSET, key: "symbol" },
  { name: "alerts", call: () => api.alerts(), row: ALERT, key: "id" },
  { name: "calibration", call: () => api.calibration(), row: CALIB, key: "symbol" },
  {
    name: "assetHistory",
    call: () => api.assetHistory("USDC"),
    row: POINT,
    key: "ts",
  },
] as const;

describe("client list methods, defensive envelope unwrap", () => {
  for (const c of CASES) {
    it(`${c.name}: unwraps the new { data: [...] } envelope`, async () => {
      stubFetchJson({
        ok: true,
        generated_at: "2026-07-24T00:00:00.000Z",
        count: 1,
        data: [c.row],
      });
      const out = await c.call();
      expect(Array.isArray(out)).toBe(true);
      expect(out).toHaveLength(1);
      expect((out[0] as unknown as Record<string, unknown>)[c.key]).toBe(
        (c.row as unknown as Record<string, unknown>)[c.key],
      );
    });

    it(`${c.name}: an empty envelope yields []`, async () => {
      stubFetchJson({
        ok: true,
        generated_at: "2026-07-24T00:00:00.000Z",
        count: 0,
        data: [],
      });
      const out = await c.call();
      expect(out).toEqual([]);
    });
  }
});
