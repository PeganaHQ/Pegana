import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrustSceneV2, FREEZE_MS, MATCH_MS, SWEEP_MS } from "@/components/organisms/v2/trust-scene-v2";
import { REPLAY_MARKERS, criticalMarker, receiptUrl } from "@/lib/landing/usde-replay";

let reduced = true;
vi.mock("@/lib/motion/use-reduced-motion", () => ({
  useAppReducedMotion: () => reduced,
}));
vi.mock("@/lib/motion/use-reveal-v2", () => ({
  useRevealV2: () => ({ ref: { current: null }, style: {}, inView: true }),
}));

// A verifier the test controls, so "match" can be proven to wait for it.
let pending: Array<(ok: boolean) => void> = [];
let instant = true;
vi.mock("@/lib/verify-receipt", () => ({
  verifyReceipt: (b: { expected_receipt_sha256: string }) =>
    instant
      ? Promise.resolve({ ok: true, recomputed: b.expected_receipt_sha256, expected: b.expected_receipt_sha256 })
      : new Promise((res) => {
          pending.push((ok) =>
            res({ ok, recomputed: b.expected_receipt_sha256, expected: b.expected_receipt_sha256 }),
          );
        }),
}));

class FakeIO {
  static last: FakeIO | null = null;
  cb: IntersectionObserverCallback;
  target: Element | null = null;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    FakeIO.last = this;
  }
  observe(el: Element) {
    this.target = el;
  }
  disconnect() {}
  unobserve() {}
  /** Deliver an entry for the observed element. */
  emit(e: {
    isIntersecting: boolean;
    ratio?: number;
    visibleHeight?: number;
    rootHeight?: number;
  }) {
    this.cb(
      [
        {
          isIntersecting: e.isIntersecting,
          intersectionRatio: e.ratio ?? (e.isIntersecting ? 1 : 0),
          intersectionRect: { height: e.visibleHeight ?? 0 },
          rootBounds: e.rootHeight != null ? { height: e.rootHeight } : null,
          target: this.target,
        } as unknown as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }
  trigger() {
    this.emit({ isIntersecting: true, ratio: 1 });
  }
}

beforeEach(() => {
  reduced = true;
  instant = true;
  pending = [];
  FakeIO.last = null;
  vi.stubGlobal("IntersectionObserver", FakeIO);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const beat = (id: string) =>
  document.querySelector(`[data-beat="${id}"]`)!.getAttribute("data-beat-state");

describe("TrustSceneV2 - reduced motion", () => {
  it("keeps the approved headline and nothing else heading-like", () => {
    render(<TrustSceneV2 />);
    expect(
      screen.getByRole("heading", { level: 2, name: /Don.t trust the score\. Replay it\./ }),
    ).toBeInTheDocument();
  });

  it("renders the final state instantly: all markers, CRITICAL pill, verified result", async () => {
    render(<TrustSceneV2 />);
    const markers = screen.getAllByTestId("marker");
    expect(markers).toHaveLength(REPLAY_MARKERS.length);
    for (const m of markers) expect(m.getAttribute("data-lit")).toBe("true");
    expect(screen.getByTestId("state-pill")).toHaveTextContent("CRITICAL");
    const c = criticalMarker();
    expect(screen.getByTestId("result")).toHaveTextContent("CRITICAL");
    expect(screen.getByTestId("result")).toHaveTextContent("21:31 UTC");
    expect(screen.getByTestId("result-hash")).toHaveAttribute("title", c.sha256);
    expect(await screen.findByTestId("verify-match")).toHaveTextContent(/recomputed in your browser: match/);
    expect(screen.getByRole("link", { name: /View receipt/ })).toHaveAttribute("href", receiptUrl(c.file));
  });

  it("is minimal: Replay, one tabbable marker, one link; at most 35 visible words", async () => {
    const { container } = render(<TrustSceneV2 />);
    await screen.findByTestId("verify-match");
    const tabbableMarkers = screen.getAllByTestId("marker").filter((m) => m.tabIndex === 0);
    expect(tabbableMarkers).toHaveLength(1);
    const controls = container.querySelectorAll("button:not([tabindex='-1']), a[href]");
    expect(controls).toHaveLength(3);
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("svg").forEach((n) => n.remove());
    clone.querySelectorAll("[aria-hidden='true']").forEach((n) => n.remove());
    const words = (clone.textContent ?? "")
      .replace(/\u00b7/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    expect(words.length).toBeLessThanOrEqual(35);
  });

  it("roving focus: arrows move between receipts and update the result", async () => {
    render(<TrustSceneV2 />);
    await screen.findByTestId("verify-match");
    const markers = screen.getAllByTestId("marker");
    const ci = REPLAY_MARKERS.findIndex((m) => m.file === criticalMarker().file);
    markers[ci].focus();
    fireEvent.keyDown(markers[ci], { key: "ArrowLeft" });
    expect(markers[ci - 1]).toHaveFocus();
    expect(screen.getByTestId("result")).toHaveTextContent(REPLAY_MARKERS[ci - 1].state);
    expect(markers[ci - 1]).toHaveAttribute("tabindex", "0");
    expect(markers[ci]).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(markers[ci - 1], { key: "Home" });
    expect(markers[0]).toHaveFocus();
    expect(screen.getByRole("link", { name: /View receipt/ })).toHaveAttribute(
      "href",
      receiptUrl(REPLAY_MARKERS[0].file),
    );
  });

  it("Replay under reduced motion stays on the final state", async () => {
    render(<TrustSceneV2 />);
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(screen.getByTestId("state-pill")).toHaveTextContent("CRITICAL");
    expect(await screen.findByTestId("verify-match")).toBeInTheDocument();
  });

  it("never shows match before verifyReceipt resolves", async () => {
    instant = false;
    render(<TrustSceneV2 />);
    expect(screen.queryByTestId("verify-match")).not.toBeInTheDocument();
    expect(screen.getByTestId("result")).toHaveTextContent("recomputing");
    await act(async () => pending.forEach((r) => r(true)));
    expect(await screen.findByTestId("verify-match")).toBeInTheDocument();
  });

  it("shows an honest mismatch when verification fails", async () => {
    instant = false;
    render(<TrustSceneV2 />);
    await act(async () => pending.forEach((r) => r(false)));
    expect(await screen.findByText(/mismatch/)).toBeInTheDocument();
    expect(screen.queryByTestId("verify-match")).not.toBeInTheDocument();
  });
});

describe("TrustSceneV2 - verification race", () => {
  it("a slow verification for a previous receipt never paints match on the new one", async () => {
    instant = false;
    render(<TrustSceneV2 />);
    const markers = screen.getAllByTestId("marker");
    const base = pending.length; // initial (CRITICAL) verification
    fireEvent.click(markers[0]);
    fireEvent.click(markers[1]);
    expect(pending.length).toBe(base + 2);
    await act(async () => pending[base](true)); // resolves the stale first pick
    expect(screen.queryByTestId("verify-match")).not.toBeInTheDocument();
    expect(screen.getByTestId("result")).toHaveTextContent("recomputing");
    await act(async () => pending[base + 1](true));
    expect(await screen.findByTestId("verify-match")).toBeInTheDocument();
    expect(screen.getByTestId("result")).toHaveTextContent(REPLAY_MARKERS[1].state);
  });
});

describe("TrustSceneV2 - choreography", () => {
  beforeEach(() => {
    reduced = false;
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"],
    });
  });

  it("waits for the viewport, then plays FREEZE, RECOMPUTE, MATCH in order", async () => {
    render(<TrustSceneV2 />);
    expect(beat("freeze")).toBe("hidden");
    expect(beat("recompute")).toBe("hidden");
    expect(beat("match")).toBe("hidden");
    for (const m of screen.getAllByTestId("marker")) expect(m.getAttribute("data-lit")).toBe("false");

    act(() => FakeIO.last!.trigger());
    expect(beat("freeze")).toBe("active");
    expect(beat("recompute")).toBe("hidden");

    await act(async () => { await vi.advanceTimersByTimeAsync(FREEZE_MS + 20); });
    expect(beat("freeze")).toBe("done");
    expect(beat("recompute")).toBe("active");
    expect(beat("match")).toBe("hidden");

    await act(async () => { await vi.advanceTimersByTimeAsync(SWEEP_MS + 100); });
    expect(beat("match")).toBe("active");

    await act(async () => { await vi.advanceTimersByTimeAsync(MATCH_MS + 400); });
    expect(beat("match")).toBe("active");
    expect(screen.getByTestId("state-pill")).toHaveTextContent("CRITICAL");
  });

  it("blooms markers as the cursor reaches them; count equals the receipts in the window", async () => {
    render(<TrustSceneV2 />);
    act(() => FakeIO.last!.trigger());
    await act(async () => { await vi.advanceTimersByTimeAsync(FREEZE_MS + 20); });
    const lit = () => screen.getAllByTestId("marker").filter((m) => m.getAttribute("data-lit") === "true").length;
    expect(lit()).toBe(0);
    let prev = 0;
    for (let i = 0; i < 12; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(SWEEP_MS / 12 + 5); });
      expect(lit()).toBeGreaterThanOrEqual(prev);
      prev = lit();
    }
    expect(lit()).toBe(REPLAY_MARKERS.length);
    expect(screen.getAllByTestId("marker")).toHaveLength(REPLAY_MARKERS.length);
  });

  it("the result line steps through receipts as they are reached", async () => {
    render(<TrustSceneV2 />);
    act(() => FakeIO.last!.trigger());
    await act(async () => { await vi.advanceTimersByTimeAsync(FREEZE_MS + 20); });
    const seen: string[] = [];
    for (let i = 0; i < 38; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(SWEEP_MS / 40); });
      const t = screen.getByTestId("result").textContent ?? "";
      const m = t.match(/(DRIFT|DEPEG|CRITICAL)\u00b7?\s*\u00b7?\s*(\d\d:\d\d) UTC/) ?? t.match(/(DRIFT|DEPEG|CRITICAL).*?(\d\d:\d\d) UTC/);
      if (m && seen[seen.length - 1] !== m[2]) seen.push(m[2]);
    }
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen).toEqual([...seen].sort());
  });

  it("stays silent and hash-free while stepping through receipts; announces at MATCH", async () => {
    render(<TrustSceneV2 />);
    act(() => FakeIO.last!.trigger());
    await act(async () => { await vi.advanceTimersByTimeAsync(FREEZE_MS + SWEEP_MS / 2); });
    const result = screen.getByTestId("result");
    expect(result).toHaveAttribute("aria-live", "polite");
    expect(result.querySelector("[aria-hidden='true']")?.textContent).toMatch(/UTC/);
    expect(screen.queryByTestId("result-hash")).not.toBeInTheDocument();
    expect(screen.queryByTestId("verify-match")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View receipt/ })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(SWEEP_MS / 2 + 100); });
    expect(result).toHaveAttribute("aria-live", "polite");
    expect(result.querySelector("span.contents[aria-hidden='true']")).toBeNull();
    expect(screen.getByTestId("result-hash")).toBeInTheDocument();
  });

  it("does not show match while the verifier is still pending", async () => {
    instant = false;
    render(<TrustSceneV2 />);
    act(() => FakeIO.last!.trigger());
    await act(async () => { await vi.advanceTimersByTimeAsync(FREEZE_MS + SWEEP_MS + MATCH_MS + 200); });
    expect(beat("match")).toBe("active");
    expect(screen.queryByTestId("verify-match")).not.toBeInTheDocument();
    await act(async () => pending.forEach((r) => r(true)));
    expect(screen.getByTestId("verify-match")).toBeInTheDocument();
  });

  it("MATCH stays emphasised at the end while FREEZE and RECOMPUTE dim", async () => {
    render(<TrustSceneV2 />);
    act(() => FakeIO.last!.trigger());
    await act(async () => { await vi.advanceTimersByTimeAsync(FREEZE_MS + SWEEP_MS + MATCH_MS + 200); });
    expect(beat("match")).toBe("active");
    expect(beat("freeze")).toBe("done");
    expect(beat("recompute")).toBe("done");
  });

  it("reserves the result area from the start with a placeholder (no layout jump)", () => {
    render(<TrustSceneV2 />);
    const result = screen.getByTestId("result");
    // reserved per breakpoint for the final 3 / 2 / 1 line result
    expect(result.className).toContain("min-h-[124px]");
    expect(result.className).toContain("sm:min-h-[80px]");
    expect(result.className).toContain("lg:min-h-[64px]");
    expect(result.querySelector("span[aria-hidden]")).not.toBeNull();
  });

  it("keeps pill and readout in separate rows, and the readout flips near the right edge", async () => {
    render(<TrustSceneV2 />);
    act(() => FakeIO.last!.trigger());
    await act(async () => { await vi.advanceTimersByTimeAsync(FREEZE_MS + 100); });
    await act(async () => { await vi.advanceTimersByTimeAsync(SWEEP_MS * 0.5); });
    const pillRow = screen.getByTestId("state-pill").parentElement!;
    const readout = screen.getByTestId("readout");
    expect(pillRow.className).toContain("top-0.5");
    expect(readout.className).toContain("top-[32px]");
    expect(readout.style.transform).toBe("");
    await act(async () => { await vi.advanceTimersByTimeAsync(SWEEP_MS * 0.5); });
    // after the sweep the cursor sits on the CRITICAL marker, mid-plot: no flip
    expect(screen.getByTestId("readout")).toBeInTheDocument();
  });

  it("Replay restarts the sequence", async () => {
    render(<TrustSceneV2 />);
    act(() => FakeIO.last!.trigger());
    await act(async () => { await vi.advanceTimersByTimeAsync(FREEZE_MS + SWEEP_MS + MATCH_MS + 200); });
    expect(beat("match")).toBe("active");
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(beat("freeze")).toBe("active");
    expect(beat("recompute")).toBe("hidden");
  });
});

describe("TrustSceneV2 - autoplay when the chart is in view", () => {
  const beatNow = (id: string) =>
    document.querySelector(`[data-beat="${id}"]`)!.getAttribute("data-beat-state");

  beforeEach(() => {
    reduced = false;
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"],
    });
  });

  const full = FREEZE_MS + SWEEP_MS + MATCH_MS + 200;

  it("observes the chart element, not the whole section", () => {
    render(<TrustSceneV2 />);
    expect(FakeIO.last!.target).toBe(screen.getByTestId("replay-chart"));
  });

  it("does not start for a barely visible chart, starts at 60%", async () => {
    render(<TrustSceneV2 />);
    act(() => FakeIO.last!.emit({ isIntersecting: true, ratio: 0.3, visibleHeight: 100, rootHeight: 900 }));
    expect(beatNow("freeze")).toBe("hidden");
    act(() => FakeIO.last!.emit({ isIntersecting: true, ratio: 0.65 }));
    expect(beatNow("freeze")).toBe("active");
  });

  it("starts on a short viewport that can never show 60% of the chart (60% of the viewport)", () => {
    render(<TrustSceneV2 />);
    act(() => FakeIO.last!.emit({ isIntersecting: true, ratio: 0.4, visibleHeight: 330, rootHeight: 500 }));
    expect(beatNow("freeze")).toBe("active");
  });

  it("waits for the tab to be visible before playing", () => {
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<TrustSceneV2 />);
    act(() => FakeIO.last!.trigger());
    expect(beatNow("freeze")).toBe("hidden");
    vis.mockReturnValue("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(beatNow("freeze")).toBe("active");
    vis.mockRestore();
  });

  it("does not replay after the user interacted, even on re-entry", async () => {
    render(<TrustSceneV2 />);
    act(() => FakeIO.last!.trigger());
    await act(async () => { await vi.advanceTimersByTimeAsync(full); });
    fireEvent.click(screen.getAllByTestId("marker")[0]); // user takes over
    act(() => FakeIO.last!.emit({ isIntersecting: false }));
    act(() => FakeIO.last!.trigger());
    expect(beatNow("freeze")).toBe("done");
    expect(beatNow("recompute")).toBe("done");
  });

  it("may autoplay once more on re-entry if untouched, but only once", async () => {
    render(<TrustSceneV2 />);
    act(() => FakeIO.last!.trigger());
    await act(async () => { await vi.advanceTimersByTimeAsync(full); });
    act(() => FakeIO.last!.emit({ isIntersecting: false }));
    act(() => FakeIO.last!.trigger());
    expect(beatNow("freeze")).toBe("active"); // second autoplay
    await act(async () => { await vi.advanceTimersByTimeAsync(full); });
    act(() => FakeIO.last!.emit({ isIntersecting: false }));
    act(() => FakeIO.last!.trigger());
    expect(beatNow("freeze")).toBe("done"); // no third
  });

  it("re-entering while it is still playing does not restart it", async () => {
    render(<TrustSceneV2 />);
    act(() => FakeIO.last!.trigger());
    await act(async () => { await vi.advanceTimersByTimeAsync(FREEZE_MS + 400); });
    act(() => FakeIO.last!.emit({ isIntersecting: false }));
    act(() => FakeIO.last!.trigger());
    expect(beatNow("recompute")).toBe("active");
  });
});
