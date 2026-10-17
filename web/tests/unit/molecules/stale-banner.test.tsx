import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StaleBanner } from "@/components/molecules/stale-banner";

// The banner reads `Date.now()` internally (useState initializer + 30s interval),
// so we drive time with fake timers to exercise the forex-weekend branch
// deterministically — the variant can't be seen live outside the weekend window.
afterEach(() => {
  vi.useRealTimers();
});

/** A timestamp `minsAgo` minutes before the faked `now` — i.e. KNOWN-stale.
 *  Default 20min is past the 15-min soft window (STALE_AFTER_MS) yet under the
 *  30-min hard threshold, so it triggers the calm/soft banner tone. */
function staleSince(now: Date, minsAgo = 20): string {
  return new Date(now.getTime() - minsAgo * 60_000).toISOString();
}

const SAT = new Date("2026-06-13T12:00:00Z"); // Saturday — forex closed
const WED = new Date("2026-06-10T12:00:00Z"); // Wednesday — forex open

describe("StaleBanner — FX-market-closed variant", () => {
  it("shows the calm 'fx market closed' variant for a stable_fx asset stale during the forex weekend", () => {
    vi.useFakeTimers();
    vi.setSystemTime(SAT);
    render(
      <StaleBanner
        symbol="EURC"
        updatedAt={staleSince(SAT)}
        assetClass="stable_fx"
      />,
    );

    expect(screen.getByText(/fx market closed/i)).toBeInTheDocument();
    expect(screen.getByText(/not an outage/i)).toBeInTheDocument();
    // Informational, not an alarming alert.
    expect(screen.getByRole("status")).toBeInTheDocument();
    // Retry is dropped — it can't change anything while forex is closed.
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("uses the normal stale tone (NOT the FX variant) for a stable_fx asset stale on a weekday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(WED);
    render(
      <StaleBanner
        symbol="EURC"
        updatedAt={staleSince(WED)}
        assetClass="stable_fx"
      />,
    );

    expect(screen.queryByText(/fx market closed/i)).toBeNull();
    expect(screen.getByText(/stale snapshot/i)).toBeInTheDocument();
    // A genuine weekday FX outage must still offer Retry.
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("never shows the FX variant for a non-FX asset, even on the weekend", () => {
    vi.useFakeTimers();
    vi.setSystemTime(SAT);
    render(
      <StaleBanner
        symbol="USDC"
        updatedAt={staleSince(SAT)}
        assetClass="stable_fiat"
      />,
    );

    expect(screen.queryByText(/fx market closed/i)).toBeNull();
    expect(screen.getByText(/stale snapshot/i)).toBeInTheDocument();
  });

  it("renders nothing when the snapshot is fresh (FX asset, weekend)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(SAT);
    const fresh = new Date(SAT.getTime() - 5_000).toISOString(); // 5s old
    const { container } = render(
      <StaleBanner symbol="EURC" updatedAt={fresh} assetClass="stable_fx" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("uses the hard 'indexer stale' alert tone for a non-FX asset stale >30min", () => {
    vi.useFakeTimers();
    vi.setSystemTime(WED);
    render(
      <StaleBanner
        symbol="USDC"
        updatedAt={staleSince(WED, 45)}
        assetClass="stable_fiat"
      />,
    );

    expect(screen.getByText(/indexer stale/i)).toBeInTheDocument();
    // The ≥30min hard tone must interrupt assistive tech (role="alert").
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("FX-closed variant OVERRIDES the hard tone — stays calm role=status even >30min into the weekend", () => {
    vi.useFakeTimers();
    vi.setSystemTime(SAT);
    // 5h stale — far past the 30min hard threshold — but it's the forex weekend.
    render(
      <StaleBanner
        symbol="EURC"
        updatedAt={staleSince(SAT, 300)}
        assetClass="stable_fx"
      />,
    );

    expect(screen.getByText(/fx market closed/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull(); // never escalates to alert
    expect(screen.queryByText(/indexer stale/i)).toBeNull();
  });

  it("interpolates the asset symbol into the FX-closed copy (not hardcoded to EURC)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(SAT);
    render(
      <StaleBanner
        symbol="BRZ"
        updatedAt={staleSince(SAT)}
        assetClass="stable_fx"
      />,
    );

    expect(screen.getByText(/fx market closed/i)).toBeInTheDocument();
    expect(screen.getByText(/\bBRZ\b/)).toBeInTheDocument();
    expect(screen.queryByText(/EURC/)).toBeNull();
  });
});
