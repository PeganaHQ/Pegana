import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { AssetCardData, LoopExposureData } from "@/lib/api/types";

let data: LoopExposureData | undefined;
let error: unknown;
vi.mock("@/lib/hooks/use-loop-exposure", () => ({
  useLoopExposure: () => ({ data, error }),
}));

import { SystemicImpact } from "@/components/organisms/systemic-impact";

const INF = { symbol: "INF" } as AssetCardData;

function exposure(debt: string): LoopExposureData {
  return {
    asset: "INF",
    loop_exposure_usd: "63916592.38",
    debt_usd: debt,
    coverage: "partial",
    by_protocol: [
      {
        protocol: "jupiter_lend",
        collateral_lev_usd: "63916592.38",
        debt_usd: debt,
      },
    ],
    cascade: [{ shock_bps: 250, liquidatable_usd: "36259106.3", positions: 12 }],
    advisory_note: "Advisory.",
  } as unknown as LoopExposureData;
}

describe("SystemicImpact", () => {
  it("never prints '$0 debt' beside liquidatable collateral", () => {
    data = exposure("0");
    const { container } = render(<SystemicImpact asset={INF} />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\$0 debt/);
    expect(text).toMatch(/\$63\.92M lev/);
  });

  it("labels non-zero debt as the asset borrowed", () => {
    data = exposure("1500000");
    const { container } = render(<SystemicImpact asset={INF} />);
    expect(container.textContent).toMatch(/\$1\.50M INF borrowed/);
  });

  it("names only the venues that reported positions", () => {
    data = exposure("0");
    const { container } = render(<SystemicImpact asset={INF} />);
    expect(container.textContent).toMatch(/positions on INF came from Jupiter Lend\./);
  });
});

describe("SystemicImpact cascade base", () => {
  // jitoSOL, 2026-10-21: $21.8M leveraged headline, $60.9M liquidatable at a
  // 2.5% depeg out of $112.3M total collateral.
  const jito = {
    asset: "jitoSOL",
    loop_exposure_usd: "21806342.52",
    collateral_usd: "112286376.51",
    debt_usd: "0",
    coverage: "partial",
    by_protocol: [
      { protocol: "kamino", collateral_lev_usd: "21806342.52", debt_usd: "0" },
    ],
    cascade: [{ shock_bps: 250, liquidatable_usd: "60859160.34", positions: "5-20" }],
    advisory_note: "advisory model estimate \u2014 not a verifiable receipt",
  } as unknown as LoopExposureData;

  it("never calls the cascade figure 'leveraged collateral' and names its real base", () => {
    data = jito;
    const { container } = render(
      <SystemicImpact asset={{ symbol: "jitoSOL" } as AssetCardData} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/of leveraged collateral crosses/);
    expect(text).toMatch(/of collateral backing a borrow crosses its\s+liquidation threshold/);
    expect(text).toMatch(/54% of \$112\.29M total jitoSOL\s+supplied\)/);
    expect(text).not.toMatch(/leveraged or not/);
  });

  it("prints the advisory note without an em-dash", () => {
    data = jito;
    const { container } = render(
      <SystemicImpact asset={{ symbol: "jitoSOL" } as AssetCardData} />,
    );
    expect(container.textContent).not.toContain("\u2014");
    expect(container.textContent).toContain(
      "advisory model estimate: not a verifiable receipt",
    );
  });
});

describe("SystemicImpact display symbol", () => {
  it("renders sHYUSD as eHYUSD", () => {
    data = {
      asset: "sHYUSD",
      loop_exposure_usd: "1000000",
      collateral_usd: "4000000",
      debt_usd: "0",
      coverage: "partial",
      by_protocol: [
        { protocol: "kamino", collateral_lev_usd: "1000000", debt_usd: "0" },
      ],
      cascade: [{ shock_bps: 250, liquidatable_usd: "2000000", positions: 3 }],
      advisory_note: "Advisory.",
    } as unknown as LoopExposureData;
    const { container } = render(
      <SystemicImpact asset={{ symbol: "sHYUSD" } as AssetCardData} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("eHYUSD");
    expect(text).not.toContain("sHYUSD");
  });
});

describe("SystemicImpact under a 429", () => {
  it("says live updates are paused instead of loading forever", () => {
    data = undefined;
    error = Object.assign(new Error("API 429"), { status: 429 });
    const { getByTestId, queryByText } = render(<SystemicImpact asset={INF} />);
    expect(getByTestId("loop-impact-error")).toHaveTextContent(
      /resume on their own/,
    );
    expect(getByTestId("loop-impact-error").textContent ?? "").not.toMatch(
      /rate limit|requests a minute|429|per IP/i,
    );
    expect(queryByText("Loading leverage exposure")).toBeNull();
    error = undefined;
  });
});
