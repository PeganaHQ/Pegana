import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductTabsV2 } from "@/components/organisms/v2/product-tabs-v2";
import type { AssetCardData } from "@/lib/api/types";

vi.mock("@/lib/motion/use-reduced-motion", () => ({
  useAppReducedMotion: () => true,
}));
vi.mock("@/lib/motion/use-reveal-v2", () => ({
  useRevealV2: () => ({ ref: { current: null }, style: {}, inView: true }),
}));

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", FakeResizeObserver);
if (typeof window.PointerEvent === "undefined") {
  class PE extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  vi.stubGlobal("PointerEvent", PE);
}

interface FakeClient {
  opts: {
    onUpdate: (a: string, p: Record<string, unknown>) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onStale?: () => void;
  };
  send: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}
const clients: FakeClient[] = [];
vi.mock("@/lib/api/ws", () => ({
  createWsClient: (_url: string, opts: FakeClient["opts"]) => {
    const c: FakeClient = {
      opts,
      send: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    clients.push(c);
    return c;
  },
}));

const asset = vi.fn();
vi.mock("@/lib/api/client", () => ({
  api: { asset: (s: string) => asset(s) },
}));

function mk(
  symbol: string,
  klass: string,
  over: Partial<AssetCardData> = {},
): AssetCardData {
  return {
    symbol,
    name: symbol,
    class: klass,
    state: "PEGGED",
    discount: "0.000951",
    intrinsic_usd: "136.489559",
    market_usd: "136.360819",
    updated_at: new Date().toISOString(),
    thresholds: { drift_bps: 45, depeg_bps: 110, critical_bps: 250 },
    ...over,
  } as AssetCardData;
}

let listData: AssetCardData[] | undefined;
vi.mock("@/lib/hooks/use-assets", () => ({
  useAssets: () => ({ data: listData }),
}));

const writeText = vi.fn();

function renderIt() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ProductTabsV2 />
    </SWRConfig>,
  );
}

const chip = () => screen.getByRole("button", { name: /Change token/i });

async function pick(symbol: string) {
  fireEvent.click(chip());
  const dlg = await screen.findByRole("dialog");
  fireEvent.click(within(dlg).getByRole("button", { name: symbol }));
}

beforeEach(() => {
  clients.length = 0;
  listData = [mk("jitoSOL", "lst"), mk("mSOL", "lst", { state: "DRIFT" }), mk("USDe", "stable_dn")];
  asset.mockReset();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  asset.mockImplementation(async (s: string) =>
    s === "mSOL"
      ? mk("mSOL", "lst", { state: "DRIFT", discount: "0.0060" })
      : mk(s, "lst"),
  );
});

describe("ProductTabsV2 - live verdict playground", () => {
  it("keeps the approved headline and has no combobox", () => {
    renderIt();
    expect(
      screen.getByRole("heading", { name: /One verdict, four open surfaces\./i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows a loading state, then the live verdict for the default token", async () => {
    listData = undefined;
    let resolve!: (v: AssetCardData) => void;
    asset.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    renderIt();
    expect(screen.getByText(/Loading the live verdict/i)).toBeInTheDocument();
    await act(async () => resolve(mk("jitoSOL", "lst")));
    expect(await screen.findByTestId("verdict-state")).toHaveTextContent("PEGGED");
    expect(screen.getByTestId("verdict-intrinsic")).toHaveTextContent("$136.49");
    expect(asset).toHaveBeenCalledWith("jitoSOL");
  });

  it("uses the holder-signed convention: raw discount means market below intrinsic", async () => {
    asset.mockResolvedValue(mk("jitoSOL", "lst", { discount: "0.000951" }));
    renderIt();
    // raw +9.51 bps (market below intrinsic) -> holder discount, negative
    expect(await screen.findByTestId("verdict-discount")).toHaveTextContent("−0.10%");
  });

  it("shows a premium as positive (raw negative discount)", async () => {
    listData = undefined;
    asset.mockResolvedValue(mk("jitoSOL", "lst", { discount: "-0.0060" }));
    renderIt();
    await waitFor(() =>
      expect(screen.getByTestId("verdict-discount")).toHaveTextContent("+0.60%"),
    );
  });

  it("places the scale marker from the absolute discount and thresholds", async () => {
    renderIt();
    const marker = await screen.findByTestId("scale-marker");
    // 10 bps / (250 * 1.25) = 3.2%
    expect(Number(marker.getAttribute("data-percent"))).toBeCloseTo(3.2, 1);
  });

  it("the token chip carries a real icon and a chevron, no modal text line", () => {
    renderIt();
    expect(chip().querySelector("img")?.getAttribute("src")).toBe(
      "https://api.pegana.xyz/static/tokens/J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn.webp",
    );
    expect(chip().textContent).toBe("jitoSOL");
  });

  it("selecting a token updates the verdict and the request line, and closes the panel", async () => {
    renderIt();
    await screen.findByTestId("verdict-state");
    await pick("mSOL");
    await waitFor(() =>
      expect(screen.getByTestId("verdict-state")).toHaveTextContent("DRIFT"),
    );
    expect(asset).toHaveBeenCalledWith("mSOL");
    expect(screen.getByTestId("request-line")).toHaveTextContent(
      "GET https://api.pegana.xyz/v1/assets/mSOL",
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(chip()).toHaveFocus();
  });

  it("surface switch only swaps the one request line", async () => {
    renderIt();
    await screen.findByTestId("verdict-state");
    const line = screen.getByTestId("request-line");
    expect(line).toHaveTextContent("GET https://api.pegana.xyz/v1/assets/jitoSOL");
    fireEvent.click(screen.getByRole("button", { name: "WS" }));
    expect(line).toHaveTextContent("wss://api.pegana.xyz/v1/ws");
    fireEvent.click(screen.getByRole("button", { name: "MCP" }));
    expect(line).toHaveTextContent("get_asset_state");
    fireEvent.click(screen.getByRole("button", { name: "CLI" }));
    expect(line).toHaveTextContent("pegana-replay --alert-id");
  });

  it("renders an honest error state with retry", async () => {
    listData = undefined;
    asset.mockRejectedValue(new Error("down"));
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the API/);
    expect(screen.queryByTestId("verdict-state")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("keeps the last list reading but says the refresh failed", async () => {
    asset.mockRejectedValue(new Error("down"));
    renderIt();
    expect(await screen.findByTestId("verdict-state")).toHaveTextContent("PEGGED");
    expect(await screen.findByText(/Live refresh failed/i)).toBeInTheDocument();
  });

  it("shows UNKNOWN (with no marker) when the API has no state", async () => {
    listData = undefined;
    asset.mockResolvedValue(
      mk("jitoSOL", "lst", { state: "UNKNOWN", discount: null, intrinsic_usd: null, market_usd: null }),
    );
    renderIt();
    await waitFor(() =>
      expect(screen.getByTestId("verdict-state")).toHaveTextContent("UNKNOWN"),
    );
    expect(screen.getByTestId("verdict-discount")).toHaveTextContent("no reading");
    expect(screen.queryByTestId("scale-marker")).not.toBeInTheDocument();
    expect(screen.getByTestId("verdict-market")).toHaveTextContent("n/a");
  });

  it("degrades a stale snapshot to UNKNOWN and says so", async () => {
    listData = undefined;
    asset.mockResolvedValue(
      mk("jitoSOL", "lst", {
        state: "DEPEG",
        updated_at: new Date(Date.now() - 40 * 60_000).toISOString(),
      }),
    );
    renderIt();
    await waitFor(() =>
      expect(screen.getByTestId("verdict-state")).toHaveTextContent("UNKNOWN"),
    );
    expect(screen.getByText(/Older than 15 minutes/)).toBeInTheDocument();
    expect(screen.queryByTestId("scale-marker")).not.toBeInTheDocument();
  });

  it("does not announce the per-second ticker", async () => {
    renderIt();
    await screen.findByTestId("verdict-state");
    const ticker = screen.getByText(/^updated/i);
    expect(ticker.closest("[aria-live]")).toBeNull();
  });

  it("copies only on success", async () => {
    renderIt();
    await screen.findByTestId("verdict-state");
    writeText.mockRejectedValueOnce(new Error("blocked"));
    fireEvent.click(screen.getByRole("button", { name: /copy request/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("copied")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /copy request/i }));
    expect(await screen.findByText("copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenLastCalledWith(
      "GET https://api.pegana.xyz/v1/assets/jitoSOL",
    );
  });
});

describe("ProductTabsV2 - WebSocket", () => {
  const frame = (over: Record<string, unknown>) => ({
    state: "DEPEG",
    discount: "0.0200",
    intrinsic_usd: "136.49",
    market_usd: "133.76",
    updated_at: new Date(Date.now() + 5_000).toISOString(),
    ...over,
  });

  it("opens one socket for the section and swaps subscriptions without reconnecting", async () => {
    renderIt();
    await screen.findByTestId("verdict-state");
    expect(clients).toHaveLength(1);
    act(() => clients[0].opts.onOpen?.());
    expect(clients[0].send).toHaveBeenCalledWith({ op: "subscribe", assets: ["jitoSOL"] });
    await pick("mSOL");
    await waitFor(() =>
      expect(clients[0].send).toHaveBeenCalledWith({ op: "subscribe", assets: ["mSOL"] }),
    );
    expect(clients[0].send).toHaveBeenCalledWith({ op: "unsubscribe", assets: ["jitoSOL"] });
    expect(clients).toHaveLength(1);
    expect(clients[0].disconnect).not.toHaveBeenCalled();
  });

  it("ignores frames for other symbols and stale frames; a newer frame wins", async () => {
    renderIt();
    await screen.findByTestId("verdict-state");
    act(() => clients[0].opts.onOpen?.());

    act(() => clients[0].opts.onUpdate("USDe", frame({ state: "CRITICAL" })));
    expect(screen.getByTestId("verdict-state")).toHaveTextContent("PEGGED");

    act(() =>
      clients[0].opts.onUpdate(
        "jitoSOL",
        frame({ updated_at: new Date(Date.now() - 600_000).toISOString() }),
      ),
    );
    expect(screen.getByTestId("verdict-state")).toHaveTextContent("PEGGED");

    act(() => clients[0].opts.onUpdate("jitoSOL", frame({})));
    expect(screen.getByTestId("verdict-state")).toHaveTextContent("DEPEG");
    expect(screen.getByTestId("verdict-discount")).toHaveTextContent("−2.00%");
  });

  it("rejects an invalid state in a frame", async () => {
    renderIt();
    await screen.findByTestId("verdict-state");
    act(() => clients[0].opts.onOpen?.());
    act(() => clients[0].opts.onUpdate("jitoSOL", frame({ state: "NOPE" })));
    expect(screen.getByTestId("verdict-state")).not.toHaveTextContent("NOPE");
  });

  it("stops retrying after repeated failed handshakes and keeps polling", async () => {
    renderIt();
    await screen.findByTestId("verdict-state");
    act(() => clients[0].opts.onClose?.());
    act(() => clients[0].opts.onClose?.());
    expect(clients[0].disconnect).not.toHaveBeenCalled();
    act(() => clients[0].opts.onClose?.());
    expect(clients[0].disconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/polling every 30s/)).toBeInTheDocument();
    expect(screen.getByTestId("verdict-state")).toHaveTextContent("PEGGED");
  });

  it("a socket that was once open keeps reconnecting after drops (never gives up)", async () => {
    renderIt();
    await screen.findByTestId("verdict-state");
    act(() => clients[0].opts.onOpen?.());
    for (let i = 0; i < 5; i++) act(() => clients[0].opts.onClose?.());
    expect(clients[0].disconnect).not.toHaveBeenCalled();
  });

  it("a torn-down client cannot flip the label after unmount", async () => {
    const { unmount } = renderIt();
    await screen.findByTestId("verdict-state");
    const old = clients[0];
    unmount();
    expect(old.disconnect).toHaveBeenCalled();
    expect(() => old.opts.onClose?.()).not.toThrow();
  });
});

describe("ProductTabsV2 - polish", () => {
  it("preloads the eight icons in an off-screen, hidden, non-interactive container", () => {
    renderIt();
    const box = screen.getByTestId("icon-preload");
    expect(box).toHaveAttribute("aria-hidden", "true");
    expect(box.style.pointerEvents).toBe("none");
    expect(box.style.display).not.toBe("none");
    expect(box.style.overflow).toBe("hidden");
    const imgs = Array.from(box.querySelectorAll("img"));
    expect(imgs).toHaveLength(8);
    for (const i of imgs) {
      expect(i.getAttribute("loading")).toBe("eager");
      expect(i.getAttribute("decoding")).toBe("sync");
      expect(i.getAttribute("alt")).toBe("");
    }
    expect(imgs[0].getAttribute("src")).toBe(
      "https://api.pegana.xyz/static/tokens/J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn.webp",
    );
  });

  it("calls decode() on the preloaded images", () => {
    const decode = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLImageElement.prototype, "decode", { value: decode, configurable: true });
    renderIt();
    expect(decode).toHaveBeenCalledTimes(8);
    delete (HTMLImageElement.prototype as unknown as { decode?: unknown }).decode;
  });

  it("decodes the preload exactly once across several ticker re-renders", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    const decode = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLImageElement.prototype, "decode", { value: decode, configurable: true });
    renderIt();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(decode).toHaveBeenCalledTimes(8);
    delete (HTMLImageElement.prototype as unknown as { decode?: unknown }).decode;
    vi.useRealTimers();
  });

  it("closed state mounts no popover layer or popper wrapper", () => {
    renderIt();
    expect(document.querySelector("[data-radix-popper-content-wrapper]")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("popover tiles render eagerly with exactly the preloaded srcs", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderIt();
    const pre = Array.from(screen.getByTestId("icon-preload").querySelectorAll("img")).map((i) => i.getAttribute("src"));
    fireEvent.pointerEnter(chip(), { pointerType: "mouse" });
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    const imgs = Array.from(screen.getByRole("dialog").querySelectorAll("img"));
    expect(imgs).toHaveLength(8);
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(pre);
    for (const img of imgs) expect(img.getAttribute("loading")).toBe("eager");
    vi.useRealTimers();
  });

  it("uses one unit: headline and scale are both percentages", async () => {
    renderIt();
    const d = await screen.findByTestId("verdict-discount");
    expect(d.textContent).toMatch(/%$/);
    expect(document.body.textContent).toContain("0.45%");
    expect(document.body.textContent).toContain("1.1%");
    expect(document.body.textContent).toContain("2.5%");
    expect(document.body.textContent).not.toMatch(/\bbps\b/);
  });
});

describe("ProductTabsV2 - hover token popover", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const mouse = { pointerType: "mouse" };
  const panel = () => screen.queryByRole("dialog");
  const adv = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it("exposes popup semantics on the chip", async () => {
    renderIt();
    expect(chip()).toHaveAttribute("aria-haspopup", "dialog");
    expect(chip()).toHaveAttribute("aria-expanded", "false");
    fireEvent.pointerEnter(chip(), mouse);
    await adv(120);
    expect(chip()).toHaveAttribute("aria-expanded", "true");
    expect(chip().getAttribute("aria-controls")).toBe(panel()!.id);
  });

  it("opens on hover only after the ~100ms intent delay", async () => {
    renderIt();
    fireEvent.pointerEnter(chip(), mouse);
    await adv(60);
    expect(panel()).not.toBeInTheDocument();
    await adv(60);
    expect(panel()).toBeInTheDocument();
  });

  it("opens on top of the chip (flips to the bottom only when there is no room)", async () => {
    renderIt();
    fireEvent.pointerEnter(chip(), mouse);
    await adv(120);
    expect(panel()!.getAttribute("data-side")).toBe("top");
  });

  it("is a non-modal popover: no aria-modal, no scroll lock, page stays interactive", async () => {
    renderIt();
    fireEvent.pointerEnter(chip(), mouse);
    await adv(120);
    expect(panel()).not.toHaveAttribute("aria-modal", "true");
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(screen.getByRole("button", { name: "WS" })).toBeEnabled();
    expect(within(panel()!).getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("moving from the chip into the panel keeps it open", async () => {
    renderIt();
    fireEvent.pointerEnter(chip(), mouse);
    await adv(120);
    fireEvent.pointerLeave(chip(), mouse);
    await adv(80);
    fireEvent.pointerEnter(panel()!, mouse);
    await adv(600);
    expect(panel()).toBeInTheDocument();
  });

  it("leaving both closes it after the grace period", async () => {
    renderIt();
    fireEvent.pointerEnter(chip(), mouse);
    await adv(120);
    fireEvent.pointerLeave(chip(), mouse);
    await adv(150);
    expect(panel()).toBeInTheDocument();
    await adv(100);
    expect(panel()).not.toBeInTheDocument();
  });

  it("a tap toggles it (touch has no hover)", async () => {
    renderIt();
    fireEvent.pointerDown(chip(), { pointerType: "touch" });
    fireEvent.click(chip());
    await adv(0);
    expect(panel()).toBeInTheDocument();
    fireEvent.pointerDown(chip(), { pointerType: "touch" });
    fireEvent.click(chip());
    await adv(0);
    expect(panel()).not.toBeInTheDocument();
  });

  it("a click after hover-open keeps it open (does not toggle it shut)", async () => {
    renderIt();
    fireEvent.pointerEnter(chip(), mouse);
    await adv(120);
    fireEvent.pointerDown(chip(), mouse);
    fireEvent.click(chip());
    await adv(0);
    expect(panel()).toBeInTheDocument();
  });

  it("keyboard: ArrowDown opens and focuses the selected token; arrows/Home/End roam; Esc returns focus", async () => {
    renderIt();
    chip().focus();
    fireEvent.keyDown(chip(), { key: "ArrowDown" });
    await adv(0);
    const items = within(panel()!).getAllByRole("button");
    expect(items).toHaveLength(8);
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: "ArrowRight" });
    expect(items[1]).toHaveFocus();
    expect(items[1]).toHaveAttribute("tabindex", "0");
    expect(items[0]).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(items[1], { key: "End" });
    expect(items[7]).toHaveFocus();
    fireEvent.keyDown(items[7], { key: "Home" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: "Escape" });
    await adv(0);
    expect(panel()).not.toBeInTheDocument();
    expect(chip()).toHaveFocus();
  });

  it("keyboard: Enter on the chip opens and moves focus into the grid", async () => {
    renderIt();
    chip().focus();
    fireEvent.click(chip()); // Enter/Space arrive as a click with no pointer
    await adv(0);
    expect(within(panel()!).getAllByRole("button")[0]).toHaveFocus();
  });

  it("a single ArrowDown lands focus on the SELECTED tile (not the first)", async () => {
    renderIt();
    fireEvent.click(chip());
    await adv(0);
    fireEvent.click(within(panel()!).getByRole("button", { name: "mSOL" }));
    await adv(0);
    expect(panel()).not.toBeInTheDocument();
    chip().focus();
    fireEvent.keyDown(chip(), { key: "ArrowDown" });
    await adv(0);
    const active = document.activeElement as HTMLElement;
    expect(panel()!.contains(active)).toBe(true);
    expect(active).toHaveAttribute("aria-pressed", "true");
    expect(active).toHaveTextContent("mSOL");
  });

  it("a single Enter lands focus on the SELECTED tile (not the first)", async () => {
    renderIt();
    fireEvent.click(chip());
    await adv(0);
    fireEvent.click(within(panel()!).getByRole("button", { name: "mSOL" }));
    await adv(0);
    expect(panel()).not.toBeInTheDocument();
    chip().focus();
    fireEvent.click(chip()); // Enter arrives as one click with no pointer
    await adv(0);
    const active = document.activeElement as HTMLElement;
    expect(panel()!.contains(active)).toBe(true);
    expect(active).toHaveAttribute("aria-pressed", "true");
    expect(active).toHaveTextContent("mSOL");
  });

  it("Tab out of the grid closes it and hands focus to the chip (natural order)", async () => {
    renderIt();
    fireEvent.keyDown(chip(), { key: "ArrowDown" });
    await adv(0);
    const first = within(panel()!).getAllByRole("button")[0];
    expect(first).toHaveFocus();
    const notPrevented = fireEvent.keyDown(first, { key: "Tab" });
    expect(notPrevented).toBe(true); // default Tab continues from the chip
    await adv(0);
    expect(panel()).not.toBeInTheDocument();
    expect(chip()).toHaveFocus();
  });

  it("Shift+Tab from the grid closes it and lands on the chip", async () => {
    renderIt();
    fireEvent.keyDown(chip(), { key: "ArrowDown" });
    await adv(0);
    const first = within(panel()!).getAllByRole("button")[0];
    const notPrevented = fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(notPrevented).toBe(false);
    await adv(0);
    expect(panel()).not.toBeInTheDocument();
    expect(chip()).toHaveFocus();
  });

  it("ArrowDown on the chip while hover-open moves focus into the grid", async () => {
    renderIt();
    fireEvent.pointerEnter(chip(), mouse);
    await adv(120);
    chip().focus();
    fireEvent.keyDown(chip(), { key: "ArrowDown" });
    expect(within(panel()!).getAllByRole("button")[0]).toHaveFocus();
    // a later hover-open must not steal focus
    fireEvent.keyDown(within(panel()!).getAllByRole("button")[0], { key: "Escape" });
    await adv(0);
    chip().blur();
    fireEvent.pointerEnter(chip(), mouse);
    await adv(120);
    expect(panel()).toBeInTheDocument();
    expect(panel()!.contains(document.activeElement)).toBe(false);
  });

  it("does not hover-close while the grid holds keyboard focus", async () => {
    renderIt();
    fireEvent.keyDown(chip(), { key: "ArrowDown" });
    await adv(0);
    fireEvent.pointerEnter(panel()!, mouse);
    fireEvent.pointerLeave(panel()!, mouse);
    await adv(600);
    expect(panel()).toBeInTheDocument();
  });

  it("a touch tap (pointerdown, pointerup, pointerleave, click) toggles like a mouse, no grid focus", async () => {
    renderIt();
    const touch = { pointerType: "touch" };
    fireEvent.pointerDown(chip(), touch);
    fireEvent.pointerUp(chip(), touch);
    fireEvent.pointerLeave(chip(), touch);
    fireEvent.click(chip());
    await adv(0);
    expect(panel()).toBeInTheDocument();
    expect(panel()!.contains(document.activeElement)).toBe(false);
    fireEvent.pointerDown(chip(), touch);
    fireEvent.pointerUp(chip(), touch);
    fireEvent.pointerLeave(chip(), touch);
    fireEvent.click(chip());
    await adv(0);
    expect(panel()).not.toBeInTheDocument();
  });

  it("an abandoned mouse press does not make Enter look like a mouse click", async () => {
    renderIt();
    fireEvent.pointerDown(chip(), mouse);
    fireEvent.pointerLeave(chip(), mouse);
    fireEvent.click(chip()); // keyboard-style activation afterwards
    await adv(0);
    expect(within(panel()!).getAllByRole("button")[0]).toHaveFocus();
  });

  it("shows live state dots only for fresh non-UNKNOWN readings", async () => {
    renderIt();
    fireEvent.pointerEnter(chip(), mouse);
    await adv(120);
    expect(within(panel()!).getByTestId("dot-mSOL")).toBeInTheDocument();
    expect(within(panel()!).queryByTestId("dot-USDC")).not.toBeInTheDocument();
  });
});
