import { act } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CommandPalette,
  openCommandPalette,
} from "@/components/organisms/command-palette";
import type { AssetCardData } from "@/lib/api/types";

// Command palette pulls assets + live updates + routing — stub each so the
// verb rows (watchlist toggle / compare) can be exercised without a network
// or a real Next.js router.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

let assets: AssetCardData[] = [];
vi.mock("@/lib/hooks/use-assets", () => ({
  useAssets: () => ({ data: assets }),
}));
vi.mock("@/lib/store/live-context", () => ({
  useLive: () => ({ byAsset: {} }),
}));

// This jsdom install doesn't ship a working Storage implementation (window
// .localStorage exists but its methods are missing) — same gotcha documented
// in tests/unit/asset/chart-bucket.test.ts. Swap in a minimal working
// in-memory shim so the real `lib/store/watchlist.ts` round-trip is actually
// exercised, not silently swallowed by its own try/catch.
function installLocalStorageShim() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

function asset(symbol: string, name: string): AssetCardData {
  return {
    symbol,
    name,
    class: "stable_fiat",
    mint: `mint-${symbol}`,
    state: "PEGGED",
    discount: "0",
    intrinsic_usd: "1.0000",
    market_usd: "1.0000",
    updated_at: new Date().toISOString(),
  } as unknown as AssetCardData;
}

async function openPalette() {
  render(<CommandPalette />);
  act(() => {
    openCommandPalette();
  });
  return screen.findByRole("combobox");
}

describe("CommandPalette verbs", () => {
  beforeEach(() => {
    push.mockClear();
    installLocalStorageShim();
    assets = [
      asset("USDC", "USD Coin"),
      asset("USDT", "Tether"),
      asset("USDS", "Sky USD"),
      asset("PYUSD", "PayPal USD"),
      asset("sUSD", "Synthetix USD"),
      asset("sHYUSD", "Staked Hylo USD"),
    ];
  });

  it("shows no Actions/verb rows on the default (empty-query) list", async () => {
    const input = await openPalette();
    expect(input).toHaveValue("");
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    expect(screen.queryByText(/↵ run/)).not.toBeInTheDocument();
  });

  it("surfaces watchlist + compare verbs once the query matches assets, capped at 6 rows", async () => {
    const input = await openPalette();
    fireEvent.change(input, { target: { value: "US" } });

    expect(await screen.findByText("Actions")).toBeInTheDocument();
    // 5 assets match "US" — capped to 3 assets × 2 verbs = 6 rows, not 10.
    const runAffordances = screen.getAllByText("↵ run");
    expect(runAffordances.length).toBe(6);
  });

  it("clicking 'Add SYM to watchlist' toggles the real store and announces before closing", async () => {
    const input = await openPalette();
    fireEvent.change(input, { target: { value: "USDC" } });

    const addBtn = await screen.findByRole("option", {
      name: /Add USDC to watchlist/i,
    });
    fireEvent.click(addBtn);

    const stored = window.localStorage.getItem("pegana.watchlist.v1");
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored as string)).toEqual(
      expect.arrayContaining(["USDC"]),
    );
    expect(
      await screen.findByText(/USDC added to watchlist/i),
    ).toBeInTheDocument();
  });

  it("clicking 'Compare SYM…' pushes the /compare?s= URL contract", async () => {
    const input = await openPalette();
    fireEvent.change(input, { target: { value: "USDC" } });

    const compareBtn = await screen.findByRole("option", {
      name: /Compare USDC/i,
    });
    fireEvent.click(compareBtn);

    expect(push).toHaveBeenCalledWith("/compare?s=USDC");
  });

  it("keeps existing nav items as plain actions — no duplicate verb for them", async () => {
    const input = await openPalette();
    fireEvent.change(input, { target: { value: "dashboard" } });

    const goTo = screen.getByText("Go to");
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByText(/Dashboard/i).length).toBeGreaterThan(0);
    expect(goTo).toBeInTheDocument();
    // No verb affordance should appear for a nav-item-only match.
    expect(screen.queryByText("↵ run")).not.toBeInTheDocument();
  });

  it("typing the eHYUSD display alias surfaces the sHYUSD asset row, rendered as eHYUSD", async () => {
    const input = await openPalette();
    fireEvent.change(input, { target: { value: "eHYUSD" } });

    const list = screen.getByRole("listbox");
    expect(await within(list).findByText("eHYUSD")).toBeInTheDocument();
    expect(within(list).queryByText("sHYUSD")).not.toBeInTheDocument();
  });
});
