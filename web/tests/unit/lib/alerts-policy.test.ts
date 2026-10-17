import { describe, it, expect } from "vitest";
import {
  thresholdsFor,
  dedupSecondsFor,
  formatDedupWindow,
  formatThreshold,
  PER_ASSET_THRESHOLDS,
  CLASS_FALLBACK_THRESHOLDS,
  DEDUP_SECONDS_BY_CLASS,
} from "@/lib/alerts/policy";
import type { AssetClass } from "@/lib/api/types";

describe("alerts policy lookup", () => {
  it("prefers per-symbol thresholds over class fallback", () => {
    // USDC has a specific entry — should not use stable_fiat fallback
    const t = thresholdsFor("USDC", "stable_fiat");
    expect(t.drift_bps).toBe(15);
    expect(t).toEqual(PER_ASSET_THRESHOLDS.USDC);
  });

  it("falls back to class thresholds when no per-symbol entry", () => {
    const t = thresholdsFor("BRZ", "stable_fx");
    expect(t).toEqual(CLASS_FALLBACK_THRESHOLDS.stable_fx);
  });

  it("uses ultra-wide thresholds for xSOL synth_lev", () => {
    const t = thresholdsFor("xSOL", "synth_lev");
    expect(t.drift_bps).toBeGreaterThanOrEqual(1000);
    expect(t.critical_bps).toBeGreaterThanOrEqual(3000);
  });

  it("mirrors the REAL per-asset bands from assets.toml for wide-band yield assets", () => {
    // sUSD trades at a sustained ~2.2% discount to NAV by design (rebasing
    // Token-2022, thin secondary). Its real drift band is 275 bps — NOT the
    // 30 bps stable_yield class fallback. A too-tight mirror made the engine's
    // correct PEGGED state look like a contradiction in the UI.
    expect(thresholdsFor("sUSD", "stable_yield")).toEqual({
      drift_bps: 275,
      depeg_bps: 500,
      critical_bps: 800,
    });
    // ONyc NAV drifts upward by design — band 100 bps, not the 30 fallback.
    expect(thresholdsFor("ONyc", "stable_yield").drift_bps).toBe(100);
  });
});

describe("dedup window lookup", () => {
  it("returns class-specific silence in seconds", () => {
    expect(dedupSecondsFor("lst")).toBe(3600);
    expect(dedupSecondsFor("stable_fiat")).toBe(1800);
    expect(dedupSecondsFor("stable_cdp")).toBe(900);
    expect(dedupSecondsFor("synth_lev")).toBe(1800);
  });

  it("matches the backend dispatcher silence_secs_for shape", () => {
    // Every AssetClass must have a dedup entry — otherwise the dispatcher
    // and the frontend disagree on when a user gets re-alerted.
    const classes: AssetClass[] = [
      "lst",
      "stable_fiat",
      "stable_cdp",
      "stable_dn",
      "stable_rwa",
      "stable_fx",
      "stable_yield",
      "synth_lev",
    ];
    for (const c of classes) {
      expect(DEDUP_SECONDS_BY_CLASS[c]).toBeGreaterThan(0);
      expect(CLASS_FALLBACK_THRESHOLDS[c]).toBeDefined();
    }
  });
});

describe("formatDedupWindow", () => {
  it("formats hours, minutes, seconds", () => {
    expect(formatDedupWindow(3600)).toBe("1h");
    expect(formatDedupWindow(7200)).toBe("2h");
    expect(formatDedupWindow(1800)).toBe("30 min");
    expect(formatDedupWindow(900)).toBe("15 min");
    expect(formatDedupWindow(45)).toBe("45s");
  });
});

describe("formatThreshold", () => {
  it("uses two-decimal percent for small thresholds (never raw bps)", () => {
    expect(formatThreshold(45)).toBe("0.45%");
    expect(formatThreshold(15)).toBe("0.15%");
  });

  it("uses percent only for medium thresholds", () => {
    expect(formatThreshold(250)).toBe("2.5%");
    expect(formatThreshold(560)).toBe("5.6%");
  });

  it("uses whole percent for large thresholds", () => {
    expect(formatThreshold(1500)).toBe("15%");
    expect(formatThreshold(6000)).toBe("60%");
  });
});
