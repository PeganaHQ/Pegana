import { describe, expect, it } from "vitest";
import {
  assetCoverage,
  bannerCopy,
  overallState,
  type CoverageAsset,
} from "@/lib/status/health";

const NOW = Date.parse("2026-10-21T13:00:00Z");
const fresh = new Date(NOW - 20_000).toISOString();

const a = (
  symbol: string,
  state: CoverageAsset["state"],
  extra: Partial<CoverageAsset> = {},
): CoverageAsset => ({ symbol, state, updated_at: fresh, ...extra });

const healthy = {
  readyErr: false,
  ready: { status: "ready" as const },
  snapshotAgeSec: 2,
  liveDown: false,
  liveDegraded: false,
};

describe("assetCoverage", () => {
  it("counts UNKNOWN and stale snapshots as dark, sorted", () => {
    const c = assetCoverage(
      [
        a("USDC", "PEGGED"),
        a("USX", "UNKNOWN", { state_reason: "stale_source" }),
        a("AUSD", "UNKNOWN", { state_reason: "stale_source" }),
        a("JLP", "PEGGED", {
          updated_at: new Date(NOW - 16 * 60_000).toISOString(),
        }),
      ],
      NOW,
    );
    expect(c).toEqual({ total: 4, dark: ["AUSD", "JLP", "USX"], staleSource: 2 });
  });
});

describe("overallState", () => {
  it("is operational only with every asset lit", () => {
    const coverage = assetCoverage([a("USDC", "PEGGED")], NOW);
    expect(overallState({ ...healthy, coverage })).toBe("PEGGED");
  });

  it("the 2026-10-21 case: fresh sources but 10 of 67 dark is degraded, not operational", () => {
    const list = [
      ...Array.from({ length: 57 }, (_, i) => a(`P${i}`, "PEGGED")),
      ...Array.from({ length: 10 }, (_, i) =>
        a(`U${i}`, "UNKNOWN", { state_reason: "stale_source" }),
      ),
    ];
    const coverage = assetCoverage(list, NOW);
    const overall = overallState({ ...healthy, coverage });
    expect(overall).toBe("DRIFT");
    expect(bannerCopy(overall, coverage)).toBe(
      "Degraded: 10 of 67 assets have no fresh reading.",
    );
  });

  it("keeps the outage and not-yet-measured branches", () => {
    expect(overallState({ ...healthy, readyErr: true, coverage: null })).toBe("DEPEG");
    expect(overallState({ ...healthy, ready: null, coverage: null })).toBe("UNKNOWN");
    expect(
      overallState({ ...healthy, ready: { status: "not_ready" }, coverage: null }),
    ).toBe("DEPEG");
    const lit = assetCoverage([a("USDC", "PEGGED")], NOW);
    expect(overallState({ ...healthy, snapshotAgeSec: 300, coverage: lit })).toBe(
      "DRIFT",
    );
    // Sources fresh but the asset list not checked yet: not operational.
    expect(overallState({ ...healthy, coverage: null })).toBe("UNKNOWN");
    expect(overallState({ ...healthy, coverage: null, coverageErr: false })).toBe("UNKNOWN");
  });

  it("never claims operational copy for a degraded state", () => {
    expect(bannerCopy("DRIFT", null)).toBe("Operating with degraded freshness.");
    expect(bannerCopy("PEGGED", null)).toBe("All systems operational.");
  });

  it("does not stay on 'Checking systems...' once the asset fetch has failed", () => {
    const overall = overallState({ ...healthy, coverage: null, coverageErr: true });
    expect(overall).toBe("DRIFT");
    expect(bannerCopy(overall, null, true)).toBe(
      "Degraded: asset coverage is unavailable right now.",
    );
    // Still loading (no error) keeps the genuine initial state.
    expect(bannerCopy("UNKNOWN", null, false)).toBe("Checking systems...");
  });

  it("a failed asset fetch never masks a real outage", () => {
    expect(
      overallState({ ...healthy, ready: { status: "not_ready" }, coverage: null, coverageErr: true }),
    ).toBe("DEPEG");
    expect(overallState({ ...healthy, readyErr: true, coverage: null, coverageErr: true })).toBe("DEPEG");
  });
});
