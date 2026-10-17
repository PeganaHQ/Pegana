import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { useTickFlash } from "@/lib/motion/use-tick-flash";

/**
 * WHY THIS FILE EXISTS.
 *
 * GSAP tweens `color` by writing an INLINE style, and an inline style beats the
 * element's class forever. This hook used to fade back to a hardcoded
 * `--color-text` (#f5f5f6), which meant every flashed cell ended up white no
 * matter what class it carried.
 *
 * That was invisible for months: spread cells were state-coloured and PEGGED's
 * class was `text-text` — the very same #f5f5f6 — so the bug restored the right
 * colour by coincidence. The moment spreads became sign-coloured (2026-08-10,
 * premium green / discount red) all three call sites silently reverted to white
 * on the first WebSocket tick: the asset hero's headline number and both
 * dashboard spread cells.
 *
 * No unit test could have caught it, because every unit test asserted the
 * *class*, which was correct the whole time. It took reading computed styles on
 * the deployed page. So these tests pin the two properties that actually matter.
 */

const captured: Array<Record<string, unknown>> = [];

vi.mock("@/lib/motion/gsap", () => ({
  getGsap: async () => ({
    timeline: () => {
      const tl = {
        to(_node: HTMLElement, vars: Record<string, unknown>) {
          captured.push(vars);
          // Fire onComplete synchronously — we assert the end state, and the
          // real tween's 180ms is not what is under test here.
          if (typeof vars.onComplete === "function") {
            (vars.onComplete as () => void)();
          }
          return tl;
        },
      };
      return tl;
    },
  }),
}));

/** Render the hook against a real node styled by a CLASS, then tick it. */
async function flash(className: string, opts?: { restore?: string }) {
  const node = document.createElement("span");
  node.className = className;
  document.body.append(node);

  const { rerender } = renderHook(
    ({ signal }) => {
      const ref = useRef<HTMLElement | null>(node);
      useTickFlash(ref, signal, opts);
    },
    { initialProps: { signal: 1 } },
  );

  // The hook deliberately no-ops on first render (no flash on mount), so a
  // changed signal is required to exercise it at all.
  rerender({ signal: 2 });
  await vi.waitFor(() => expect(captured.length).toBeGreaterThanOrEqual(2));

  return { node, flashVars: captured[0], restoreVars: captured[1] };
}

beforeEach(() => {
  captured.length = 0;
  // The classes under test have to resolve to real colours for the assertions
  // to mean anything; jsdom applies plain class selectors from a <style> tag.
  const style = document.createElement("style");
  style.id = "tick-flash-fixture";
  style.textContent = `
    :root { --color-text: #f5f5f6; --color-tick-flash: rgb(255, 138, 91); }
    .text-st-depeg-text { color: rgb(232, 112, 137); }
    .text-st-pegged { color: rgb(95, 211, 160); }
  `;
  document.head.append(style);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }),
  );
});

afterEach(() => {
  document.getElementById("tick-flash-fixture")?.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("useTickFlash restores the element's own colour", () => {
  it("does not repaint a red discount cell white", async () => {
    const { restoreVars } = await flash("text-st-depeg-text");

    expect(restoreVars.color).toBe("rgb(232, 112, 137)");
    // The exact regression: #f5f5f6 / rgb(245,245,246) is --color-text.
    expect(restoreVars.color).not.toBe("#f5f5f6");
    expect(restoreVars.color).not.toBe("rgb(245, 245, 246)");
  });

  it("does not repaint a green premium cell white either", async () => {
    const { restoreVars } = await flash("text-st-pegged");
    expect(restoreVars.color).toBe("rgb(95, 211, 160)");
  });

  it("clears the inline colour so a later re-render can change the sign", async () => {
    // Without this, the colour freezes at whatever it was when the flash
    // started: a cell that flips premium→discount would keep the green.
    const { node } = await flash("text-st-depeg-text");
    expect(node.style.getPropertyValue("color")).toBe("");
    expect(node.getAttribute("style") || "").not.toContain("color");
  });

  it("still flashes with the brand tick colour on the way in", async () => {
    const { flashVars } = await flash("text-st-depeg-text");
    // jsdom strips whitespace inside custom-property values, so compare the
    // channels rather than the literal string.
    expect(String(flashVars.color).replace(/\s+/g, "")).toBe(
      "rgb(255,138,91)",
    );
  });

  it("honours an explicit restore override from the caller", async () => {
    const { restoreVars } = await flash("text-st-depeg-text", {
      restore: "#123456",
    });
    expect(restoreVars.color).toBe("#123456");
  });

  it("does not flash at all under prefers-reduced-motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn() }),
    );
    const node = document.createElement("span");
    node.className = "text-st-depeg-text";
    document.body.append(node);

    const { rerender } = renderHook(
      ({ signal }) => {
        const ref = useRef<HTMLElement | null>(node);
        useTickFlash(ref, signal);
      },
      { initialProps: { signal: 1 } },
    );
    rerender({ signal: 2 });
    await Promise.resolve();

    expect(captured).toHaveLength(0);
    expect(node.style.getPropertyValue("color")).toBe("");
  });
});
