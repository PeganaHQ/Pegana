import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { revealSafety } from "@/lib/motion/gsap-reveal-safety";

describe("revealSafety", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("forces opacity:1 on elements still at 0 after the safety window", () => {
    const el = document.createElement("div");
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    document.body.appendChild(el);

    const cleanup = revealSafety([el], 2000);
    vi.advanceTimersByTime(1999);
    expect(el.style.opacity).toBe("0");
    vi.advanceTimersByTime(2);
    expect(el.style.opacity).toBe("1");
    expect(el.style.transform).toBe("none");
    cleanup();
    document.body.removeChild(el);
  });

  it("leaves elements alone when they have already been revealed", () => {
    const el = document.createElement("div");
    el.style.opacity = "1";
    document.body.appendChild(el);

    revealSafety([el], 100);
    vi.advanceTimersByTime(200);
    expect(el.style.opacity).toBe("1");
    document.body.removeChild(el);
  });

  it("cancels the timeout when cleanup runs", () => {
    const el = document.createElement("div");
    el.style.opacity = "0";
    document.body.appendChild(el);

    const cleanup = revealSafety([el], 100);
    cleanup();
    vi.advanceTimersByTime(200);
    expect(el.style.opacity).toBe("0");
    document.body.removeChild(el);
  });

  it("handles an empty list without throwing", () => {
    expect(() => revealSafety([], 50)).not.toThrow();
  });
});
