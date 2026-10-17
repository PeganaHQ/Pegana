import { describe, it, expect } from "vitest";
import { monogramInitials, classTint } from "@/lib/token-icons/monogram";

describe("monogramInitials", () => {
  it("takes the first two alphanumerics, preserving case", () => {
    expect(monogramInitials("USDC")).toBe("US");
    expect(monogramInitials("jitoSOL")).toBe("ji");
    expect(monogramInitials("hyloSOL+")).toBe("hy");
    expect(monogramInitials("sHYUSD")).toBe("sH");
    expect(monogramInitials("JLP")).toBe("JL");
  });
  it("returns the two-letter initials for a mixed-case symbol", () => {
    expect(monogramInitials("vSOL")).toBe("vS");
  });
  it("falls back to ? for an empty/symbol-less input", () => {
    expect(monogramInitials("+++")).toBe("?");
  });
});

describe("classTint", () => {
  it("maps each known class to a stable hex", () => {
    const all = [
      "lst",
      "stable_fiat",
      "stable_cdp",
      "stable_rwa",
      "stable_dn",
      "stable_fx",
      "stable_yield",
      "synth_lev",
    ] as const;
    for (const c of all) {
      expect(classTint(c)).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    // Class-identity tints must stay visually distinct from state-identity
    // colors (--color-st-pegged / --color-st-unknown) so a monogram never
    // reads as a state pip (e.g. a depegged stable_yield token showing its
    // class color would otherwise look like a PEGGED-green glyph).
    expect(classTint("stable_yield")).toBe("#a8c65a");
    expect(classTint("synth_lev")).toBe("#ff8a5b");
  });
  it("defaults to the muted neutral for an unknown/undefined class", () => {
    expect(classTint(undefined)).toBe("#96918c");
  });
});
