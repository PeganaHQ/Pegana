import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-assets", () => ({
  useAssets: () => ({ data: [] }),
}));
vi.mock("@/lib/store/live-context", () => ({
  useLive: () => ({ byAsset: {}, connected: false }),
}));
vi.mock("@/lib/store/watchlist", () => ({
  useWatchlist: () => ({ has: () => false, toggle: vi.fn() }),
}));

import {
  CommandPalette,
  openCommandPalette,
} from "@/components/organisms/command-palette";

describe("CommandPalette open triggers", () => {
  it("is closed on mount with no user input", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not open on a bare 'k' or '/' key", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k" });
    fireEvent.keyDown(document, { key: "/" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens only on Ctrl-K or the explicit opener", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openCommandPalette());
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});
