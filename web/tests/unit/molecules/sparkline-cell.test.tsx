import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Spy on useHistory so we can assert whether the cell fetches at all. The bug
// this guards: every row fetched /history (keyed off a drifting Date.now()),
// re-requesting per render/consumer. With an inline series_24h the cell must
// render with ZERO network requests.
const useHistorySpy = vi.fn((_symbol: string | null, _opts?: unknown) => ({
  data: undefined,
}));
vi.mock("@/lib/hooks/use-history", () => ({
  useHistory: (symbol: string | null, opts?: unknown) =>
    useHistorySpy(symbol, opts),
}));

import { SparklineCell } from "@/components/molecules/sparkline-cell";

beforeEach(() => useHistorySpy.mockClear());

describe("SparklineCell", () => {
  it("renders from an inline series_24h without fetching /history", () => {
    const series = [-0.0042, -0.0043, -0.0041, -0.005, -0.0042, -0.0039];
    const { container } = render(
      <SparklineCell symbol="jitoSOL" series={series} className="h-8" />,
    );
    // Drew a line.
    expect(
      container.querySelector('path[data-role="spark-line"]'),
    ).not.toBeNull();
    // Did NOT fetch — useHistory was called with a null symbol (disabled key).
    expect(useHistorySpy).toHaveBeenCalled();
    expect(useHistorySpy.mock.calls[0][0]).toBeNull();
  });

  it("falls back to a /history fetch only when no inline series is provided", () => {
    render(<SparklineCell symbol="jitoSOL" />);
    expect(useHistorySpy.mock.calls[0][0]).toBe("jitoSOL");
  });
});
