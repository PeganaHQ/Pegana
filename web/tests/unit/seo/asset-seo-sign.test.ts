import { describe, expect, it } from "vitest";
import { holderSignedPct } from "@/lib/api/format";

// Real live values pulled from api.pegana.xyz. `discount` is the RAW
// premium-NEGATIVE methodology sign; the SEO section must render the HOLDER
// sign, matching the hero. jitoSOL trades BELOW intrinsic (a discount),
// hyUSD ABOVE (a premium) — opposite directions, so this catches an inversion.
describe("asset SEO section sign convention", () => {
  const toBps = (d: string) => parseFloat(d) * 10_000;
  it("jitoSOL raw +0.000719 renders as a NEGATIVE holder gap (discount)", () => {
    expect(holderSignedPct(toBps("0.000719"))).toMatch(/^−/);
  });
  it("hyUSD raw -0.0000926 renders as a POSITIVE holder gap (premium)", () => {
    expect(holderSignedPct(toBps("-0.0000926"))).toMatch(/^\+/);
  });
});
