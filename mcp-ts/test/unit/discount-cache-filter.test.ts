import { describe, it, expect, beforeEach } from "vitest";

// Regression: engine publishes both `kind:"update"` (full snapshot) and
// `kind:"heartbeat"` (just `{kind, ts}`) on pegana:discount. Before the
// 2026-05-29 evening fix, the MCP subscriber ran normalizeDiscountSnapshot
// on every payload and called `cache.set(snap.asset, snap)` — heartbeats
// landed under key `undefined` with every required field missing, so
// `get_assets` failed Zod validation at the first non-update message.
//
// This spec exercises parseDiscountMessage, the pure filter src/redis.ts
// runs on every message, so it needs no live Redis connection.

import { parseDiscountMessage, type DiscountSnapshot } from "@/shared/types";

type CachedSnap = DiscountSnapshot;

/** Same two lines as the subscriber in src/redis.ts startCacheWarming(). */
function ingest(rawJson: string, cache: Map<string, CachedSnap>): "stored" | "skipped" {
  const snap = parseDiscountMessage(rawJson);
  if (!snap) return "skipped";
  cache.set(snap.asset, snap);
  return "stored";
}

describe("discount channel filter", () => {
  let cache: Map<string, CachedSnap>;

  beforeEach(() => {
    cache = new Map();
  });

  it("stores a full update snapshot", () => {
    const msg = JSON.stringify({
      kind: "update",
      asset: "jitoSOL",
      state: "PEGGED",
      discount: "-0.0036",
      intrinsic_usd: "104.87",
      market_usd: "105.25",
      updated_at: "2026-05-29T20:00:00.000Z",
    });
    expect(ingest(msg, cache)).toBe("stored");
    expect(cache.size).toBe(1);
    expect(cache.get("jitoSOL")?.ts).toBeTypeOf("number");
    // The engine's `kind` never reaches the cached snapshot.
    expect(Object.keys(cache.get("jitoSOL")!).sort()).toEqual(
      ["asset", "discount", "intrinsic_usd", "market_usd", "state", "ts", "updated_at"],
    );
  });

  it("skips heartbeats and never creates an `undefined` key", () => {
    const heartbeat = JSON.stringify({ kind: "heartbeat", ts: "2026-05-29T20:00:00.000Z" });
    expect(ingest(heartbeat, cache)).toBe("skipped");
    expect(cache.size).toBe(0);
    // The bug we shipped before this fix: cache.set(undefined, {...heartbeat})
    // created an entry retrievable as cache.get(undefined as unknown as string).
    // The check below proves the cache stays clean.
    expect(Array.from(cache.keys())).toEqual([]);
  });

  it("skips any non-update kind", () => {
    for (const k of ["hylo_snapshot", "boot", "unknown"]) {
      const msg = JSON.stringify({ kind: k, asset: "FAKE", state: "PEGGED" });
      expect(ingest(msg, cache)).toBe("skipped");
    }
    expect(cache.size).toBe(0);
  });

  it("skips payloads missing `asset` even without `kind`", () => {
    // Older / partial publishes that drop the kind field but also lack
    // identity — defensive guard.
    const msg = JSON.stringify({ state: "PEGGED", discount: "0", updated_at: "2026-05-29T20:00:00Z" });
    expect(ingest(msg, cache)).toBe("skipped");
    expect(cache.size).toBe(0);
  });

  it("accepts back-compat shape (no `kind` but full asset)", () => {
    const msg = JSON.stringify({
      asset: "USDC",
      state: "PEGGED",
      discount: "0",
      intrinsic_usd: "1",
      market_usd: "1",
      updated_at: "2026-05-29T20:00:00.000Z",
    });
    expect(ingest(msg, cache)).toBe("stored");
    expect(cache.get("USDC")?.asset).toBe("USDC");
  });

  it("survives malformed JSON", () => {
    expect(ingest("not-json", cache)).toBe("skipped");
    expect(cache.size).toBe(0);
  });
});
