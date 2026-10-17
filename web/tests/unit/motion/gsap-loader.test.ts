import { describe, it, expect } from "vitest";
import { getGsap, getScrollTrigger } from "@/lib/motion/gsap";

describe("gsap loader", () => {
  it("returns the same gsap instance across calls", async () => {
    const a = await getGsap();
    const b = await getGsap();
    expect(a).toBe(b);
  });

  it("returns ScrollTrigger and registers it on first call", async () => {
    const ST = await getScrollTrigger();
    expect(ST).toBeDefined();
    expect(typeof ST.create).toBe("function");
  });
});
