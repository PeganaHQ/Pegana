import { describe, it, expect, beforeEach } from "vitest";
import { prepareDrawIn } from "@/lib/motion/prepare-draw-in";

describe("prepareDrawIn", () => {
  beforeEach(() => {
    // jsdom doesn't implement getTotalLength — stub it.
    Object.defineProperty(SVGPathElement.prototype, "getTotalLength", {
      configurable: true,
      value: function () {
        return 100;
      },
    });
  });

  it("sets stroke-dasharray and stroke-dashoffset on each path", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path1 = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    const path2 = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    svg.appendChild(path1);
    svg.appendChild(path2);
    document.body.appendChild(svg);

    prepareDrawIn([path1, path2]);

    expect(path1.style.strokeDasharray).toBe("100");
    expect(path1.style.strokeDashoffset).toBe("100");
    expect(path2.style.strokeDasharray).toBe("100");
  });

  it("returns the array of total lengths for downstream tween targets", () => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const lengths = prepareDrawIn([path]);
    expect(lengths).toEqual([100]);
  });
});
