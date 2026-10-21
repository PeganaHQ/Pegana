import React from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertRow, AssetCardData, PegState } from "@/lib/api/types";

vi.mock("next/link", () => ({
  default: React.forwardRef<HTMLAnchorElement, { children?: React.ReactNode }>(
    function MockLink({ children, ...props }, ref) {
      return (
        <a ref={ref} {...props}>
          {children}
        </a>
      );
    },
  ),
}));
vi.mock("@/lib/motion/use-reduced-motion", () => ({
  useAppReducedMotion: () => true,
}));
vi.mock("@/components/molecules/events-heatmap", () => ({
  EventsHeatmap: () => null,
}));
vi.mock("@/lib/store/live-context", () => ({
  useLive: () => ({ byAsset: {} }),
  useWsDrivenPage: () => {},
}));

const state: {
  alerts: AlertRow[] | undefined;
  assets: AssetCardData[] | undefined;
} = { alerts: undefined, assets: undefined };

vi.mock("@/lib/hooks/use-alerts", () => ({
  useAlertsWindow: () => ({
    data: state.alerts
      ? { rows: state.alerts, complete: true, coverageFloorDay: null }
      : undefined,
    isLoading: !state.alerts,
    error: undefined,
    mutate: () => {},
  }),
}));
vi.mock("@/lib/hooks/use-assets", () => ({
  useAssets: () => ({ data: state.assets }),
}));

import EventsPage from "@/app/(app)/events/page";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderPage() {
  return render(
    <TooltipProvider>
      <EventsPage />
    </TooltipProvider>,
  );
}

function alert(asset: string, to_state: PegState, i: number): AlertRow {
  return {
    id: `${asset}-${i}-${to_state}`,
    asset,
    class: "unknown",
    from_state: "PEGGED",
    to_state,
    detected_at: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T01:00:00Z`,
    dispatched_at: null,
  } as AlertRow;
}

const ASSETS = [
  { symbol: "jitoSOL", class: "lst", state: "PEGGED" },
  { symbol: "USDC", class: "stable_fiat", state: "PEGGED" },
] as unknown as AssetCardData[];

const ALERTS: AlertRow[] = [
  alert("jitoSOL", "DRIFT", 1),
  alert("USDC", "DEPEG", 2),
  alert("USDC", "PEGGED", 3),
  ...Array.from({ length: 13 }, (_, i) => alert("pbUSDC", "DRIFT", 4 + i)),
  ...Array.from({ length: 4 }, (_, i) => alert("xSOL", "DRIFT", 17 + i)),
];

function group(name: string) {
  return screen.getByRole("group", { name });
}
function tab(groupName: string, label: RegExp) {
  return within(group(groupName)).queryByRole("button", { name: label });
}

describe("/events toolbar", () => {
  beforeEach(() => {
    state.alerts = undefined;
    state.assets = undefined;
  });

  it("shows en-dash counts while loading", () => {
    renderPage();
    expect(tab("Event class filter", /^All/)?.textContent).toBe("All–");
    expect(tab("Event severity filter", /^Critical/)?.textContent).toBe(
      "Critical–",
    );
  });

  it("drops the synth class, shows Retired with its tooltip trigger", () => {
    state.alerts = ALERTS;
    state.assets = ASSETS;
    renderPage();
    expect(tab("Event class filter", /Synth/)).toBeNull();
    expect(tab("Event class filter", /Other/)).toBeNull();
    expect(tab("Event class filter", /^Retired/)?.textContent).toBe(
      "Retired17",
    );
    expect(tab("Event class filter", /^LSTs/)?.textContent).toBe("LSTs1");
    expect(tab("Event class filter", /^Stables/)?.textContent).toBe("Stables2");
    expect(
      screen.getByRole("button", {
        name: /Retired assets: pbUSDC \(13\), xSOL \(4\)/,
      }),
    ).toBeTruthy();
  });

  it("hides empty buckets (Retired, Unknown) and labels Recovered", () => {
    state.alerts = ALERTS.filter(
      (a) => a.asset === "jitoSOL" || a.asset === "USDC",
    );
    state.assets = ASSETS;
    renderPage();
    expect(tab("Event class filter", /^Retired/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Retired assets/ })).toBeNull();
    expect(tab("Event severity filter", /^Unknown/)).toBeNull();
    expect(tab("Event severity filter", /Recovery/)).toBeNull();
    expect(tab("Event severity filter", /^Recovered/)?.textContent).toBe(
      "Recovered1",
    );
  });

  it("shows en-dash class counts and disables class tabs when /v1/assets failed", () => {
    state.alerts = ALERTS;
    state.assets = undefined;
    renderPage();
    const lst = tab("Event class filter", /^LSTs/) as HTMLButtonElement;
    const stables = tab("Event class filter", /^Stables/) as HTMLButtonElement;
    expect(lst.textContent).toBe("LSTs–");
    expect(stables.textContent).toBe("Stables–");
    expect(lst.disabled).toBe(true);
    expect(tab("Event class filter", /^Retired/)).toBeNull();
    expect(tab("Event class filter", /^All/)?.textContent).toBe("All20");
    // Severity is independent of the universe.
    expect(tab("Event severity filter", /^Drift/)?.textContent).toBe("Drift18");
  });
});
