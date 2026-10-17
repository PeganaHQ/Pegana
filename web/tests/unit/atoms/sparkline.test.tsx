import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Sparkline } from "@/components/atoms/sparkline";

describe("Sparkline", () => {
  it("renders an svg path with the expected number of points", () => {
    const { container } = render(<Sparkline points={[1, 2, 3, 4, 5]} />);
    const path = container.querySelector("path[data-role='spark-line']");
    expect(path).not.toBeNull();
    // path 'd' attribute should encode 5 L-commands (one per point, first is M)
    const d = path?.getAttribute("d") ?? "";
    const lCount = (d.match(/L/g) ?? []).length;
    expect(lCount).toBe(4);
  });

  it("omits the threshold ruler when thresholdBps is not provided", () => {
    const { container } = render(<Sparkline points={[1, 2, 3, 4, 5]} />);
    expect(
      container.querySelector("line[data-role='spark-threshold']"),
    ).toBeNull();
  });

  it("draws one dashed ruler at the threshold level, in the dim hairline color, never the alarm ramp", () => {
    const { container } = render(
      <Sparkline
        points={[1, 2, 3, 4, 5]}
        stroke="var(--color-st-depeg)"
        thresholdBps={3}
      />,
    );
    const rulers = container.querySelectorAll(
      "line[data-role='spark-threshold']",
    );
    expect(rulers.length).toBe(1);
    const ruler = rulers[0];
    expect(ruler.getAttribute("stroke")).toBe("var(--color-outline)");
    expect(ruler.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(ruler.getAttribute("y1")).toBe(ruler.getAttribute("y2"));
  });

  it("omits the ruler (and leaves the domain unchanged) when the threshold needs more than a 20% near-edge extension", () => {
    // range is 40 (0..40); 20% margin is 8. A threshold 160 above max is
    // nowhere close, so it must be dropped entirely rather than dragging
    // the domain (and squashing the series) toward it.
    const pts = [0, 10, 20, 30, 40];
    const { container: withThreshold } = render(
      <Sparkline points={pts} height={28} thresholdBps={200} />,
    );
    expect(
      withThreshold.querySelector("line[data-role='spark-threshold']"),
    ).toBeNull();

    const { container: bare } = render(<Sparkline points={pts} height={28} />);
    const dWith = withThreshold
      .querySelector("path[data-role='spark-line']")
      ?.getAttribute("d");
    const dBare = bare
      .querySelector("path[data-role='spark-line']")
      ?.getAttribute("d");
    // Proves the domain wasn't touched: identical geometry with or without
    // the (omitted) far threshold.
    expect(dWith).toBe(dBare);
  });

  it("draws the ruler, extending just the near edge, when the threshold is within the 20% margin", () => {
    // range is 40 (0..40); 20% margin is 8. A threshold 5 above max (45)
    // fits, so only the top edge extends — exactly to the threshold.
    const { container } = render(
      <Sparkline points={[0, 10, 20, 30, 40]} height={28} thresholdBps={45} />,
    );
    const ruler = container.querySelector("line[data-role='spark-threshold']");
    expect(ruler).not.toBeNull();
    const y = Number(ruler?.getAttribute("y1"));
    // The threshold now sits exactly at the extended domain max, so its
    // ruler renders flush with the top of the viewBox.
    expect(y).toBeCloseTo(0, 1);
  });

  it("keeps the flat-series scale floor untouched when no threshold is given", () => {
    // Regression guard for the "honest flat-pegged series" behavior: with no
    // threshold, min===max still falls back to range=1 (no NaN/collapse).
    const { container } = render(
      <Sparkline points={[0.5, 0.5, 0.5]} height={20} />,
    );
    const path = container.querySelector("path[data-role='spark-line']");
    const d = path?.getAttribute("d") ?? "";
    expect(d).not.toMatch(/NaN/);
  });
});
