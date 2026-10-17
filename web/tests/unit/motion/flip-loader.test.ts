import { describe, it, expect } from "vitest";
import { getFlip } from "@/lib/motion/get-flip";

describe("flip loader", () => {
  it("returns Flip plugin and registers it on first call", async () => {
    const flip = await getFlip();
    expect(flip).toBeDefined();
    expect(typeof flip.getState).toBe("function");
    expect(typeof flip.from).toBe("function");
  });

  it("returns the same Flip instance across calls", async () => {
    const a = await getFlip();
    const b = await getFlip();
    expect(a).toBe(b);
  });
});
