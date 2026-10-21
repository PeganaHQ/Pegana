import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  AssetSeoSection,
  mechanismSentence,
  verdictSentence,
} from "@/app/(app)/asset/[symbol]/asset-seo-section";

const lookupAsset = vi.fn();
vi.mock("@/lib/asset/fetch-asset", () => ({
  lookupAsset: (s: string) => lookupAsset(s),
}));
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFound(),
  useParams: () => ({}),
  useSearchParams: () => null,
  useRouter: () => ({}),
}));

function baseAsset(over: Record<string, unknown>) {
  return {
    symbol: "EURC",
    name: "Circle Euro Coin",
    class: "stable_fx",
    anchor: null,
    peg_target: "EUR",
    state: null,
    discount: null,
    intrinsic_usd: null,
    market_usd: null,
    market_cap: null,
    updated_at: null,
    ...over,
  };
}

describe("asset peg-risk brief", () => {
  it("does not print '-' prices or a verdict-less sentence for an unpriced asset", () => {
    render(<AssetSeoSection asset={baseAsset({})} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/last traded at/);
    expect(text).toMatch(/no current reading for EURC/);
    expect(text).toMatch(/shown as Unknown/);
  });

  it("prints the price sentence when both sides are known", () => {
    render(
      <AssetSeoSection
        asset={baseAsset({
          symbol: "USDC",
          name: "USD Coin",
          class: "stable_fiat",
          state: "PEGGED",
          discount: "0.0001",
          market_usd: "0.9999",
          intrinsic_usd: "1",
        })}
      />,
    );
    expect(screen.getByText(/last traded at/)).toBeTruthy();
  });

  it("gives JLP its own mechanism copy, not 'expected to trade above $1.00'", () => {
    const s = mechanismSentence("JLP", "stable_yield", "JLP");
    expect(s).not.toMatch(/above \$1\.00/);
    expect(s).toMatch(/NAV per token/);
    expect(mechanismSentence("USD*", "stable_yield", "USD*")).toMatch(
      /above \$1\.00/,
    );
  });

  it("never claims 'inside its calibrated drift band' when the read is outside it", () => {
    const out = verdictSentence("X", "PEGGED", "+36.7%", {
      absBps: 3670,
      driftBps: 200,
    });
    expect(out).not.toMatch(/inside its calibrated drift band/);
    expect(out).not.toMatch(/holding its peg/);
    const inside = verdictSentence("X", "PEGGED", "+0.01%", {
      absBps: 1,
      driftBps: 50,
    });
    expect(inside).toMatch(/inside its calibrated drift band/);
  });
});

describe("asset page server status", () => {
  beforeEach(() => {
    lookupAsset.mockReset();
    notFound.mockClear();
  });

  it("answers 404 for a symbol the API denies", async () => {
    lookupAsset.mockResolvedValue({ kind: "not_found" });
    const { default: AssetPage } = await import(
      "@/app/(app)/asset/[symbol]/page"
    );
    await expect(
      AssetPage({ params: Promise.resolve({ symbol: "NOPE" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers 404 for a leveraged synth (no peg verdict for crawlers)", async () => {
    lookupAsset.mockResolvedValue({
      kind: "found",
      asset: baseAsset({ symbol: "xSOL", class: "synth_lev", state: "PEGGED" }),
    });
    const { default: AssetPage } = await import(
      "@/app/(app)/asset/[symbol]/page"
    );
    await expect(
      AssetPage({ params: Promise.resolve({ symbol: "xSOL" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("still renders when the API is merely unavailable (never a false 404)", async () => {
    lookupAsset.mockResolvedValue({ kind: "unavailable" });
    const { default: AssetPage } = await import(
      "@/app/(app)/asset/[symbol]/page"
    );
    await expect(
      AssetPage({ params: Promise.resolve({ symbol: "USDC" }) }),
    ).resolves.toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
  });
});
