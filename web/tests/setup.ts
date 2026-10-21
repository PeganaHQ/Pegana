import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { __resetFreshnessForTests } from "@/lib/api/freshness";

// The browser-side 429 gate (lib/api/freshness.ts) is module state; a 429 in
// one test must not hold back fetches in the next.
afterEach(() => {
  __resetFreshnessForTests();
});

// jsdom doesn't expose SVGPathElement as a global, but tests that stub getTotalLength need it.
// We expose the constructor so Object.defineProperty(SVGPathElement.prototype, ...) works.
if (
  typeof window !== "undefined" &&
  typeof (window as typeof window & { SVGPathElement?: unknown })
    .SVGPathElement === "undefined"
) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).SVGPathElement = path.constructor;
}

// GSAP ScrollTrigger calls matchMedia during registerPlugin; jsdom doesn't implement it.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom's <dialog> is a bare HTMLElement subclass — no showModal()/close(),
// no `open` IDL reflection, no close/cancel events, no inert-background.
// Real browsers (incl. Playwright's Chromium for the e2e suite) implement
// all of this; this is a jsdom-only shim, feature-detected so it never
// shadows a real implementation, closely mirroring the spec algorithm so
// components built against native <dialog> (e.g. MobileMenu) can be unit
// tested without crashing on `.showModal is not a function`.
if (
  typeof window !== "undefined" &&
  typeof window.HTMLDialogElement !== "undefined" &&
  typeof window.HTMLDialogElement.prototype.showModal !== "function"
) {
  type PolyfilledDialog = HTMLDialogElement & {
    __inertTargets?: Element[];
    __previouslyFocused?: HTMLElement | null;
    __onKeydown?: (e: KeyboardEvent) => void;
  };

  // Elements that are siblings of the dialog (at any depth up to <body>) —
  // i.e. everything that is NOT the dialog, NOT one of its descendants, and
  // NOT one of its ancestors (ancestors must stay reachable/non-inert so the
  // dialog itself keeps rendering). Mirrors the HTML spec's "inert" section
  // closely enough for tests to exercise real background-inerting.
  const collectInertSiblings = (dialog: HTMLDialogElement): Element[] => {
    const ancestors = new Set<Element>();
    for (let n = dialog.parentElement; n; n = n.parentElement) ancestors.add(n);
    const targets: Element[] = [];
    const walk = (node: Element) => {
      for (const child of Array.from(node.children)) {
        if (child === dialog) continue;
        if (ancestors.has(child)) {
          walk(child);
          continue;
        }
        targets.push(child);
      }
    };
    if (document.body) walk(document.body);
    return targets;
  };

  Object.defineProperty(window.HTMLDialogElement.prototype, "open", {
    configurable: true,
    get(this: HTMLDialogElement) {
      return this.hasAttribute("open");
    },
    set(this: HTMLDialogElement, value: boolean) {
      if (value) this.setAttribute("open", "");
      else this.removeAttribute("open");
    },
  });

  window.HTMLDialogElement.prototype.show = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  window.HTMLDialogElement.prototype.showModal = function (
    this: PolyfilledDialog,
  ) {
    if (this.hasAttribute("open")) return;
    this.setAttribute("open", "");
    this.__previouslyFocused = document.activeElement as HTMLElement | null;
    const targets = collectInertSiblings(this);
    this.__inertTargets = targets;
    for (const el of targets) {
      el.setAttribute("aria-hidden", "true");
      (el as HTMLElement & { inert?: boolean }).inert = true;
    }
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const notPrevented = this.dispatchEvent(
        new Event("cancel", { cancelable: true }),
      );
      if (notPrevented) this.close();
    };
    this.__onKeydown = onKeydown;
    document.addEventListener("keydown", onKeydown);
    // Focus the autofocus target (self or descendant) if present, else the
    // dialog itself — approximates the spec's "dialog focusing steps".
    const autofocusTarget = this.hasAttribute("autofocus")
      ? this
      : this.querySelector<HTMLElement>("[autofocus]");
    (autofocusTarget ?? this).focus?.({ preventScroll: true });
  };

  window.HTMLDialogElement.prototype.close = function (
    this: PolyfilledDialog,
    returnValue?: string,
  ) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    if (returnValue !== undefined) this.returnValue = returnValue;
    const targets = this.__inertTargets ?? [];
    for (const el of targets) {
      el.removeAttribute("aria-hidden");
      (el as HTMLElement & { inert?: boolean }).inert = false;
    }
    this.__inertTargets = undefined;
    if (this.__onKeydown) {
      document.removeEventListener("keydown", this.__onKeydown);
      this.__onKeydown = undefined;
    }
    this.dispatchEvent(new Event("close"));
    this.__previouslyFocused?.focus?.({ preventScroll: true });
    this.__previouslyFocused = undefined;
  };
}
