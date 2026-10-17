import { describe, it, expect } from "vitest";
import {
  buildDigestLines,
  closestToBand,
  computeVerdictCounts,
  lastRealTransition,
  mostVolatile,
  verdictHeadline,
  verdictPill,
} from "@/lib/asset/digest";
import type { AlertRow, AssetCardData, PegState } from "@/lib/api/types";

const NOW = Date.parse("2026-07-11T12:00:00.000Z");
const FRESH = new Date(NOW - 30_000).toISOString();
// Beyond STALE_AFTER_MS (15-min server-aligned window) so the freshness gate
// degrades it to UNKNOWN / skips it.
const STALE = new Date(NOW - 20 * 60_000).toISOString();

function mk(
  symbol: string,
  state: PegState,
  overrides: Partial<AssetCardData> = {},
): AssetCardData {
  return {
    symbol,
    name: `${symbol} name`,
    mint: `mint-${symbol}`,
    class: "stable_fiat",
    peg_target: "USD",
    decimals: 6,
    state,
    discount: "0",
    intrinsic_usd: "1",
    market_usd: "1",
    updated_at: FRESH,
    ...overrides,
  } as AssetCardData;
}

function alert(
  id: string,
  asset: string,
  from_state: PegState,
  to_state: PegState,
  detected_at: string,
): AlertRow {
  return {
    id,
    asset,
    class: "stable_fiat",
    from_state,
    to_state,
    detected_at,
    dispatched_at: detected_at,
  };
}

describe("verdictPill (topbar chip summary)", () => {
  it("calm day: green PEGGED, 'All holding'", () => {
    expect(verdictPill({ total: 63, offPeg: 0, drift: 0, unknown: 0 })).toEqual(
      {
        state: "PEGGED",
        label: "All holding",
      },
    );
  });

  it("drift wins over calm; label counts the drifting", () => {
    expect(verdictPill({ total: 63, offPeg: 0, drift: 2, unknown: 0 })).toEqual(
      {
        state: "DRIFT",
        label: "2 drifting",
      },
    );
  });

  it("off-peg is worst-first over drift; coarse DEPEG bucket", () => {
    expect(verdictPill({ total: 63, offPeg: 1, drift: 4, unknown: 0 })).toEqual(
      {
        state: "DEPEG",
        label: "1 off peg",
      },
    );
  });

  it("partial-unknown calm day drops 'All' so it never overclaims coverage", () => {
    expect(verdictPill({ total: 63, offPeg: 0, drift: 0, unknown: 3 })).toEqual(
      {
        state: "PEGGED",
        label: "Holding",
      },
    );
  });

  it("whole universe unconfirmable says so, never a fake peg (H1/H9)", () => {
    expect(verdictPill({ total: 5, offPeg: 0, drift: 0, unknown: 5 })).toEqual({
      state: "UNKNOWN",
      label: "Unconfirmed",
    });
  });

  it("empty universe is a dash, not a false 'All holding'", () => {
    expect(verdictPill({ total: 0, offPeg: 0, drift: 0, unknown: 0 })).toEqual({
      state: "PEGGED",
      label: "-",
    });
  });
});

describe("computeVerdictCounts + verdictHeadline", () => {
  it("calm day: all pegged reads as a confident, complete sentence", () => {
    const assets = [mk("USDC", "PEGGED"), mk("USDT", "PEGGED")];
    const counts = computeVerdictCounts(assets, {}, NOW);
    expect(counts).toEqual({ total: 2, offPeg: 0, drift: 0, unknown: 0 });
    expect(verdictHeadline(counts)).toBe("All 2 assets holding peg.");
  });

  it("worst-first: any DEPEG/CRITICAL/BLACK_SWAN wins over DRIFT", () => {
    const assets = [
      mk("USDC", "PEGGED"),
      mk("USDT", "DRIFT"),
      mk("USDe", "DEPEG"),
    ];
    const counts = computeVerdictCounts(assets, {}, NOW);
    expect(counts.offPeg).toBe(1);
    expect(verdictHeadline(counts)).toBe("1 asset off peg right now.");
  });

  it("CRITICAL/BLACK_SWAN also counts into offPeg (same template)", () => {
    const assets = [
      mk("A", "CRITICAL"),
      mk("B", "BLACK_SWAN"),
      mk("C", "PEGGED"),
    ];
    const counts = computeVerdictCounts(assets, {}, NOW);
    expect(counts.offPeg).toBe(2);
    expect(verdictHeadline(counts)).toBe("2 assets off peg right now.");
  });

  it("drift-only: names the holding-peg remainder", () => {
    const assets = [mk("A", "DRIFT"), mk("B", "PEGGED"), mk("C", "PEGGED")];
    const counts = computeVerdictCounts(assets, {}, NOW);
    expect(verdictHeadline(counts)).toBe("1 asset drifting. 2 holding peg.");
  });

  it("unknown-only (no drift/offPeg): confirmable-assets phrasing", () => {
    const assets = [mk("A", "PEGGED"), mk("B", "UNKNOWN")];
    const counts = computeVerdictCounts(assets, {}, NOW);
    expect(verdictHeadline(counts)).toBe(
      "All confirmable assets holding peg. 1 unconfirmed.",
    );
  });

  it("a stale snapshot counts as unknown in the verdict, never as pegged", () => {
    const assets = [mk("A", "PEGGED", { updated_at: STALE })];
    const counts = computeVerdictCounts(assets, {}, NOW);
    expect(counts).toEqual({ total: 1, offPeg: 0, drift: 0, unknown: 1 });
    expect(verdictHeadline(counts)).toBe(
      "All confirmable assets holding peg. 1 unconfirmed.",
    );
  });

  it("a stale CRITICAL never inflates offPeg (freshness gate wins)", () => {
    const assets = [
      mk("A", "CRITICAL", { updated_at: STALE }),
      mk("B", "PEGGED"),
    ];
    const counts = computeVerdictCounts(assets, {}, NOW);
    expect(counts.offPeg).toBe(0);
    expect(counts.unknown).toBe(1);
  });

  it("deprecated assets are excluded from every bucket", () => {
    const assets = [mk("dSOL", "CRITICAL"), mk("USDC", "PEGGED")];
    const counts = computeVerdictCounts(assets, {}, NOW);
    expect(counts).toEqual({ total: 1, offPeg: 0, drift: 0, unknown: 0 });
  });

  it("liveOverrides state wins over the REST snapshot when fresh", () => {
    const assets = [mk("A", "PEGGED")];
    const counts = computeVerdictCounts(
      assets,
      { A: { state: "DEPEG", updated_at: FRESH } },
      NOW,
    );
    expect(counts.offPeg).toBe(1);
  });
});

describe("closestToBand", () => {
  it("picks the max bandProximity among non-stale readable assets", () => {
    const assets = [
      // USDC thresholds: drift 15, depeg 50 (see lib/alerts/policy defaults)
      mk("USDC", "PEGGED", {
        discount: "0.001",
        intrinsic_usd: "1",
        market_usd: "0.999",
      }), // ~10 bps
      mk("USDT", "PEGGED", {
        discount: "0.003",
        intrinsic_usd: "1",
        market_usd: "0.997",
      }), // ~30 bps
    ];
    const leader = closestToBand(assets, {}, NOW);
    expect(leader?.symbol).toBe("USDT");
    expect(leader?.bpsAway).toBeGreaterThanOrEqual(0);
  });

  it("skips stale assets — a frozen snapshot never wins the leaderboard", () => {
    const assets = [
      mk("USDC", "DEPEG", {
        updated_at: STALE,
        discount: "0.02",
        intrinsic_usd: "1",
        market_usd: "0.98",
      }),
      mk("USDT", "PEGGED", {
        discount: "0.001",
        intrinsic_usd: "1",
        market_usd: "0.999",
      }),
    ];
    const leader = closestToBand(assets, {}, NOW);
    expect(leader?.symbol).toBe("USDT");
  });

  it("returns null only when nothing is readable (never fabricates a leader)", () => {
    const assets = [
      mk("A", "UNKNOWN", {
        discount: null,
        intrinsic_usd: null,
        market_usd: null,
      }),
    ];
    expect(closestToBand(assets, {}, NOW)).toBeNull();
  });

  // ADR-0021 direction-sensitive carve-out — the exact regression this pass
  // fixes: a Pegged LST premium (market ABOVE intrinsic, e.g. mSOL ~+1.05%)
  // must never win "closest to band" over a genuinely-drifting discount
  // elsewhere, even though its raw |bps| magnitude is larger.
  it("a benign LST premium never outranks a real discount-side risk, despite a larger raw |bps|", () => {
    const assets = [
      // mSOL thresholds: drift 40, depeg 100, critical 250 (lib/alerts/policy).
      // intrinsic 189.00, market 190.99 ⇒ market ABOVE intrinsic ⇒ premium,
      // |bps| ≈ 105 — LARGER than USDT's 30 bps below, but benign (carved
      // out). `discount: null` so reconcileBps computes fresh from the raw
      // prices instead of trusting `mk()`'s default "0" declared value.
      mk("mSOL", "PEGGED", {
        class: "lst",
        discount: null,
        intrinsic_usd: "189.00",
        market_usd: "190.99",
      }),
      // USDT thresholds: drift 15, depeg 50, critical 200. A real 30 bps
      // discount ⇒ prox 0.6 — the actual worst risk in this universe.
      mk("USDT", "DRIFT", {
        discount: null,
        intrinsic_usd: "1",
        market_usd: "0.997",
      }),
    ];
    const leader = closestToBand(assets, {}, NOW);
    expect(leader?.symbol).toBe("USDT");
  });

  it("a benign LST premium's bpsAway reports the FULL depeg distance (calm), not a misleadingly small gap", () => {
    // Alone in the universe, the carved-out premium still wins (nothing else
    // to rank against) — but bpsAway must read as "as far as possible from
    // depeg", not the magnitude-based gap (which would even go negative:
    // depeg_bps 100 − |bps| 105 = −5 → clamped to a scary "0 bps away").
    const assets = [
      mk("mSOL", "PEGGED", {
        class: "lst",
        discount: null,
        intrinsic_usd: "189.00",
        market_usd: "190.99",
      }),
    ];
    const leader = closestToBand(assets, {}, NOW);
    expect(leader?.symbol).toBe("mSOL");
    expect(leader?.prox).toBe(0);
    expect(leader?.bpsAway).toBe(100); // mSOL's own depeg_bps — the full distance
  });

  it("a genuine LST discount of the same magnitude is NOT carved out — ranks normally", () => {
    const assets = [
      mk("mSOL", "DRIFT", {
        class: "lst",
        discount: null,
        intrinsic_usd: "190.99",
        market_usd: "189.00", // market BELOW intrinsic ⇒ a real discount
      }),
    ];
    const leader = closestToBand(assets, {}, NOW);
    expect(leader?.symbol).toBe("mSOL");
    expect(leader?.prox).toBeGreaterThan(0);
    expect(leader?.bpsAway).toBeLessThan(100);
  });
});

describe("mostVolatile", () => {
  it("picks the max pegJitter among assets with a usable series", () => {
    const assets = [
      mk("A", "PEGGED", { series_24h: [0, 0, 0] }), // ~0 jitter
      mk("B", "PEGGED", { series_24h: [0, 0.01, -0.01, 0.02] }), // wide dispersion
    ];
    const leader = mostVolatile(assets, {}, NOW);
    expect(leader?.symbol).toBe("B");
  });

  it("excludes assets with no usable series rather than treating them as zero", () => {
    const assets = [mk("A", "PEGGED", { series_24h: [] })];
    expect(mostVolatile(assets, {}, NOW)).toBeNull();
  });
});

describe("lastRealTransition", () => {
  it("filters out UNKNOWN-involved rows (initializations, not real transitions)", () => {
    const alerts = [
      alert("1", "A", "UNKNOWN", "PEGGED", FRESH),
      alert("2", "B", "DRIFT", "DEPEG", FRESH),
    ];
    const t = lastRealTransition(alerts);
    expect(t?.symbol).toBe("B");
    expect(t?.alertId).toBe("2");
  });

  it("returns null when every row is an UNKNOWN-involved initialization", () => {
    const alerts = [alert("1", "A", "UNKNOWN", "PEGGED", FRESH)];
    expect(lastRealTransition(alerts)).toBeNull();
  });

  it("returns null on an empty/undefined feed (fresh system, not an error)", () => {
    expect(lastRealTransition([])).toBeNull();
    expect(lastRealTransition(undefined)).toBeNull();
  });
});

describe("buildDigestLines", () => {
  it("calm day: closest-to-band line only, no negative/empty lines", () => {
    const lines = buildDigestLines({
      closest: {
        symbol: "USDT",
        name: "Tether",
        mint: "m",
        class: "stable_fiat",
        state: "PEGGED",
        bps: 30,
        bpsAway: 20,
        prox: 0.6,
        thresholds: { drift_bps: 30, depeg_bps: 100, critical_bps: 200 },
      },
      transition: null,
      deliveryFailed24h: 0,
      nowMs: NOW,
    });
    expect(lines).toEqual([{ text: "Closest to its band: USDT, 0.20% away." }]);
    // Never a "0 transitions" / "0 failures" placeholder line.
    for (const l of lines) {
      expect(l.text.toLowerCase()).not.toMatch(
        /\b0 (transition|failure|deliver|change)/,
      );
    }
  });

  it("includes the last transition with a receipt link when one exists", () => {
    const lines = buildDigestLines({
      closest: null,
      transition: {
        symbol: "USDe",
        from: "PEGGED",
        to: "DRIFT",
        detectedAt: new Date(NOW - 2 * 86_400_000).toISOString(),
        alertId: "alert-42",
      },
      deliveryFailed24h: 0,
      nowMs: NOW,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Last transition: USDe Pegged→Drift, 2d ago.");
    expect(lines[0].href).toBe("/audit/alert-42");
  });

  it("includes delivery-failed only when > 0, with correct pluralization", () => {
    const zero = buildDigestLines({
      closest: null,
      transition: null,
      deliveryFailed24h: 0,
      nowMs: NOW,
    });
    expect(zero).toEqual([]);

    const one = buildDigestLines({
      closest: null,
      transition: null,
      deliveryFailed24h: 1,
      nowMs: NOW,
    });
    expect(one[0].text).toBe("1 delivery failed in 24h.");

    const many = buildDigestLines({
      closest: null,
      transition: null,
      deliveryFailed24h: 3,
      nowMs: NOW,
    });
    expect(many[0].text).toBe("3 deliveries failed in 24h.");
  });

  it("worst-first ordering: closest-to-band, then transition, then delivery", () => {
    const lines = buildDigestLines({
      closest: {
        symbol: "USDT",
        name: "Tether",
        mint: "m",
        class: "stable_fiat",
        state: "PEGGED",
        bps: 30,
        bpsAway: 20,
        prox: 0.6,
        thresholds: { drift_bps: 30, depeg_bps: 100, critical_bps: 200 },
      },
      transition: {
        symbol: "USDe",
        from: "PEGGED",
        to: "DRIFT",
        detectedAt: FRESH,
        alertId: "alert-1",
      },
      deliveryFailed24h: 2,
      nowMs: NOW,
    });
    expect(lines.map((l) => l.text)).toEqual([
      "Closest to its band: USDT, 0.20% away.",
      "Last transition: USDe Pegged→Drift, 30s ago.",
      "2 deliveries failed in 24h.",
    ]);
  });
});
