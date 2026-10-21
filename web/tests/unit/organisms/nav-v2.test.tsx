import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavV2 } from "@/components/organisms/v2/nav-v2";

vi.mock("@/components/molecules/mobile-menu", () => ({ MobileMenu: () => null }));

let reduced = false;
vi.mock("@/lib/motion/use-reduced-motion", () => ({
  useAppReducedMotion: () => reduced,
}));

let heroBottom = 700;
const NAV_BOTTOM = 80;

function mount(variant: "landing" | "site" = "landing", withHero = true) {
  return render(
    <main>
      {withHero && <header data-testid="hero" />}
      <NavV2 variant={variant} />
    </main>,
  );
}

function stubRects() {
  const hero = document.querySelector("main > header");
  if (hero) hero.getBoundingClientRect = () => ({ bottom: heroBottom }) as DOMRect;
  screen.getByTestId("nav-pill").getBoundingClientRect = () =>
    ({ bottom: NAV_BOTTOM }) as DOMRect;
}

const glass = () => screen.getByTestId("nav-pill").style.getPropertyValue("--nav-glass");

async function scrollTo(bottom: number) {
  heroBottom = bottom;
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(20);
  });
}

beforeEach(() => {
  reduced = false;
  heroBottom = 700;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (q: string) => ({
      matches: q.includes("920"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("NavV2 dynamic glass", () => {
  it("is near-clear over the hero (--nav-glass 0)", async () => {
    mount();
    stubRects();
    await scrollTo(700);
    expect(glass()).toBe("0.000");
  });

  it("interpolates continuously as the hero edge passes under the nav", async () => {
    mount();
    stubRects();
    await scrollTo(NAV_BOTTOM + 200);
    expect(Number(glass())).toBeCloseTo(0.5, 2);
    await scrollTo(NAV_BOTTOM + 140);
    expect(Number(glass())).toBeCloseTo(0.75, 2);
  });

  it("stays frosted (1) once past the hero, never opaque", async () => {
    mount();
    stubRects();
    await scrollTo(-500);
    expect(glass()).toBe("1.000");
    const style = screen.getByTestId("nav-pill").getAttribute("style") ?? "";
    expect(style).toContain("calc(.38 + .38 * var(--nav-glass, 1))");
  });

  it("defaults to frosted when there is no hero (variable unset, CSS falls back to 1)", async () => {
    mount("landing", false);
    await scrollTo(0);
    expect(glass()).toBe("");
  });

  it("the site variant never tracks a hero", async () => {
    mount("site");
    stubRects();
    await scrollTo(700);
    expect(glass()).toBe("");
  });

  it("reduced motion jumps between the endpoints", async () => {
    reduced = true;
    mount();
    stubRects();
    await scrollTo(NAV_BOTTOM + 210);
    expect(glass()).toBe("0.000");
    await scrollTo(NAV_BOTTOM + 190);
    expect(glass()).toBe("1.000");
  });

  it("removes its listeners and cancels the frame on unmount", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = mount();
    stubRects();
    const added = add.mock.calls.filter(([t]) => t === "scroll" || t === "resize");
    expect(added.length).toBe(3); // padding-shrink scroll + glass scroll + resize
    expect(added.every(([, , o]) => (o as AddEventListenerOptions)?.passive === true)).toBe(true);
    unmount();
    for (const [t, fn] of added) {
      expect(remove).toHaveBeenCalledWith(t, fn);
    }
  });
});

describe("NavV2 glass follows the live board inside the hero", () => {
  it("stays light while the board is below the nav, frosted when its top reaches it", async () => {
    render(
      <main>
        <header>
          <div data-testid="board"><table className="v2-hero-btable" /></div>
        </header>
        <NavV2 />
      </main>,
    );
    const hero = document.querySelector("main > header")!;
    hero.getBoundingClientRect = () => ({ bottom: -9999 }) as DOMRect; // hero bottom must be ignored
    let top = 400;
    screen.getByTestId("board").getBoundingClientRect = () => ({ top }) as DOMRect;
    screen.getByTestId("nav-pill").getBoundingClientRect = () => ({ bottom: NAV_BOTTOM }) as DOMRect;
    const go = async (t: number) => {
      top = t;
      await act(async () => {
        window.dispatchEvent(new Event("scroll"));
        await vi.advanceTimersByTimeAsync(20);
      });
    };
    await go(400);
    expect(glass()).toBe("0.000");
    await go(NAV_BOTTOM + 60);
    expect(Number(glass())).toBeCloseTo(0.5, 2);
    await go(NAV_BOTTOM);
    expect(glass()).toBe("1.000");
  });
});

describe("NavV2 fallback is pixel-identical to the previous nav", () => {
  const OLD = [
    "background-color: rgba(12,12,14,.62)",
    "border-color: var(--v2-line)",
    "box-shadow: 0 8px 40px rgba(0,0,0,.35)",
  ];
  const style = () => screen.getByTestId("nav-pill").getAttribute("style") ?? "";
  const norm = (t: string) => t.replace(/\s+/g, " ").replace(/rgba\(12,\s*12,\s*14,\s*0?\.62\)/, "rgba(12,12,14,.62)");

  it("site variant keeps the old inline values and no saturate", async () => {
    mount("site");
    stubRects();
    await scrollTo(700);
    const st = norm(style());
    for (const o of OLD) expect(st).toContain(o);
    expect(st).not.toContain("saturate");
    expect(st).not.toContain("calc(");
  });

  it("fallback never goes through calc or the glass variable, with the exact old blur and shadow", async () => {
    mount("site");
    stubRects();
    await scrollTo(700);
    const st = norm(style());
    expect(st).not.toContain("calc(");
    expect(st).not.toContain("--nav-glass");
    expect(st).not.toContain("saturate");
    expect(st).toContain("box-shadow: 0 8px 40px rgba(0,0,0,.35)");
    expect(st).toContain("background-color: rgba(12,12,14,.62)");
    expect(st).toContain("border-color: var(--v2-line)");
    expect(st).toMatch(/blur\(20px\)/);
  });

  it("below the navpill breakpoint keeps the old values", async () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
      matches: false, media: q, addEventListener() {}, removeEventListener() {},
    });
    mount();
    stubRects();
    await scrollTo(700);
    expect(style()).not.toContain("saturate");
    expect(style()).not.toContain("--nav-glass");
    expect(norm(style())).toContain("border-color: var(--v2-line)");
  });

  it("the ramped border and saturate apply only when the desktop glass is active", async () => {
    mount();
    stubRects();
    await scrollTo(700);
    expect(style()).toContain("saturate");
    expect(style()).toContain("calc(");
  });
});

describe("NavV2 backdrop root", () => {
  // A backdrop-filter only samples content up to its nearest ancestor that is
  // a backdrop root (filter, opacity < 1, mask, clip-path, mix-blend-mode,
  // backdrop-filter, will-change of those, or a view-transition-name). Verified
  // in Chromium: a parent with view-transition-name left text SHARP behind a
  // 28px blur. None of the pill's ancestors inside NavV2 may create one.
  const BAD = [
    "opacity",
    "filter",
    "backdrop-filter",
    "will-change",
    "mask",
    "clip-path",
    "mix-blend-mode",
    "view-transition-name",
  ];

  for (const variant of ["landing", "site"] as const) {
    it(`no ancestor of the pill creates a backdrop root (${variant})`, () => {
      mount(variant);
      let el = screen.getByTestId("nav-pill").parentElement;
      let hops = 0;
      while (el && el.tagName !== "MAIN") {
        const st = el.getAttribute("style") ?? "";
        for (const prop of BAD) expect(st, `${el.tagName} ${prop}`).not.toContain(prop);
        expect(el.className).not.toMatch(/\b(opacity-|blur-|backdrop-|will-change|mix-blend|mask|filter)/);
        el = el.parentElement;
        hops += 1;
      }
      expect(hops).toBeGreaterThanOrEqual(2); // inner wrapper + <nav>
    });
  }

  it("the view-transition-name lives on the pill itself", () => {
    mount();
    expect(screen.getByTestId("nav-pill").style.getPropertyValue("view-transition-name")).toBe("marketing-nav");
    expect(document.querySelector("nav")!.getAttribute("style") ?? "").not.toContain("view-transition-name");
  });
});

describe("NavV2 Methodology link", () => {
  for (const variant of ["landing", "site"] as const) {
    it(`goes to the methodology page, never an in-page anchor (${variant})`, () => {
      mount(variant);
      const links = screen.getAllByRole("link", { name: /Methodology/ });
      expect(links.length).toBeGreaterThan(0);
      for (const a of links) expect(a).toHaveAttribute("href", "/methodology");
    });
  }
});
